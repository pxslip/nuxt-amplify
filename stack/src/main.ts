// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { Construct } from 'constructs';
import { App, TerraformStack, CloudBackend, NamedCloudWorkspace, TerraformIterator } from 'cdktf';
import { config } from 'dotenv';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { Lambda } from '@gen/lambda';
import { join, resolve } from 'path';
import { DataAwsCloudfrontOriginRequestPolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-origin-request-policy';
import { DataAwsCloudfrontCachePolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-cache-policy';
import { DataAwsCloudfrontResponseHeadersPolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-response-headers-policy';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { readdirSync } from 'fs';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';

// Load the .env file
config();

class NuxtOnAWSStack extends TerraformStack {
  // #bucketPrefix = 'main';

  constructor(scope: Construct, id: string) {
    super(scope, id);
    // define resources here
    new AwsProvider(this, 'aws_provider', {
      profile: process.env.AWS_PROFILE,
    });
    const certificate = new AcmCertificate(this, 'nuxt_certificate', {
      domainName: 'nuxt-aws.pxslip.com',
      validationMethod: 'DNS',
      validationOption: [{ domainName: 'nuxt-aws.pxslip.com', validationDomain: 'pxslip.com' }],
    });

    const bucket = new S3Bucket(this, 'nuxt_bucket', {
      forceDestroy: true,
    });

    const serverPath = resolve(join('..', '.output', 'server'));
    const lambda = new Lambda(this, 'nuxt_handler', {
      runtime: 'nodejs18.x',
      handler: 'index.handler',
      sourcePath: serverPath,
      lambdaAtEdge: true,
      functionName: 'NuxtOnAWSHandler',
      description: 'Lambda Edge handler to do SSR work for Nuxt on AWS',
    });

    // upload the `public` directory to the bucket, should use the env variable of the branch name, or `main` as the default
    const pubPath = resolve('..', '.output', 'public');
    // add the lambda handler to the server output
    const files = Array.from(this.walk(pubPath)).map((value) => value);
    const iterator = TerraformIterator.fromList(files);
    const prefix = 'main'; // TODO: makes this dynamic based on env variables
    new S3Object(this, 'nuxt_bucket_public_objects', {
      forEach: iterator,
      bucket: bucket.bucket,
      key: `${prefix}${iterator.value}`,
      source: `${pubPath}${iterator.value}`,
    });
    const allViewerOriginRequestPolicy = new DataAwsCloudfrontOriginRequestPolicy(
      this,
      'all_viewer_origin_request_policy',
      { name: 'Managed-AllViewer' }
    );
    const cacheOptimizedCachePolicy = new DataAwsCloudfrontCachePolicy(this, 'cache_optimized_cache_policy', {
      name: 'Managed-CachingOptimized',
    });
    const secHeadersPolicy = new DataAwsCloudfrontResponseHeadersPolicy(this, 'security_header_response_policy', {
      name: 'Managed-SecurityHeadersPolicy',
    });
    new CloudfrontDistribution(this, 'nuxt_cfd', {
      enabled: true,
      aliases: ['nuxt-aws.pxslip.com'],
      origin: [
        {
          domainName: bucket.bucketRegionalDomainName,
          originId: 's3_bucket',
        },
      ],
      defaultCacheBehavior: {
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
        cachedMethods: ['GET', 'HEAD'],
        targetOriginId: 's3_bucket',
        viewerProtocolPolicy: 'redirect-to-https',
        cachePolicyId: cacheOptimizedCachePolicy.id,
        originRequestPolicyId: allViewerOriginRequestPolicy.id,
        responseHeadersPolicyId: secHeadersPolicy.id,
        lambdaFunctionAssociation: [
          {
            eventType: 'origin-request',
            lambdaArn: lambda.lambdaFunctionQualifiedArnOutput,
            includeBody: true,
          },
        ],
      },
      restrictions: {
        geoRestriction: {
          restrictionType: 'none',
        },
      },
      viewerCertificate: {
        acmCertificateArn: certificate.arn,
        minimumProtocolVersion: 'TLSv1.2_2021',
        sslSupportMethod: 'sni-only',
      },
      loggingConfig: {
        bucket: bucket.bucketDomainName,
        prefix: 'logs',
      },
    });
  }

  private *walk(path: string, { stripPrefix } = { stripPrefix: '' }): Generator<string, undefined, undefined> {
    const entries = readdirSync(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const pathPrefix = path.replace(stripPrefix, '');
        const filePath = join(pathPrefix, entry.name);
        yield filePath;
      } else if (entry.isDirectory()) {
        // recurse and yield the results
        const childPath = join(path, entry.name);
        yield* this.walk(childPath, { stripPrefix: path });
      }
    }
    return;
  }
}

const app = new App();
const stack = new NuxtOnAWSStack(app, 'nuxt-on-aws');
new CloudBackend(stack, {
  hostname: process.env.TERRAFORM_HOST,
  organization: process.env.TERRAFORM_ORG!,
  workspaces: new NamedCloudWorkspace(process.env.TERRAFORM_WORKSPACE!),
});
app.synth();
