import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { DataAwsCloudfrontCachePolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-cache-policy';
import { DataAwsCloudfrontOriginRequestPolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-origin-request-policy';
import { DataAwsCloudfrontResponseHeadersPolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-response-headers-policy';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { Route53Zone } from '@cdktf/provider-aws/lib/route53-zone';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { TerraformIterator, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';
import { resolve } from 'path';
import { Lambda } from '@gen/lambda';

interface CoreStackConfiguration {
  domainName: string;
  siteIdentifier: string;
  ssrHandlerFunctionName: string;
  routeHandlerFunctionName?: string;
  validationDomain?: string;
  bucketName?: string;
}

export class CoreStack extends TerraformStack {
  constructor(
    scope: Construct,
    id: string,
    { siteIdentifier, domainName, validationDomain, bucketName, ssrHandlerFunctionName }: CoreStackConfiguration
  ) {
    super(scope, id);
    const aws = new AwsProvider(this, 'aws_provider', {
      profile: process.env.AWS_PROFILE,
    });
    const accountId = aws.allowedAccountIds?.at(0);
    const region = aws.region;
    validationDomain = validationDomain ?? domainName;
    bucketName = bucketName ?? domainName;
    const ssrHandlerFunctionArn = `arn:aws:lambda:${region}:${accountId}:function:${ssrHandlerFunctionName}`;
    // define our connection to AWS, uses the environment variables to figure out the key/secret

    // generate an ACM certificate for provided domain
    const certificate = new AcmCertificate(this, 'tls_certificate', {
      domainName: `*.${domainName}`,
      subjectAlternativeNames: [domainName],
      validationMethod: 'DNS',
      validationOption: [{ domainName, validationDomain }],
    });

    // set up route53 and create the validation records for teh tls certificate
    const zone = new Route53Zone(this, 'dns_zone', {
      name: domainName,
      comment: 'Zone for hosted nuxt site, allows for pr/branch based previews',
    });
    const validationRecordsIterator = TerraformIterator.fromList(certificate.domainValidationOptions);
    const validationRecord = new Route53Record(this, 'acm_validation_records', {
      forEach: validationRecordsIterator,
      zoneId: zone.zoneId,
      name: '${each.value.name}',
      records: ['${each.value.record}'],
      type: '${each.value.type}',
      allowOverwrite: true,
      ttl: 60,
    });
    validationRecord.addOverride(
      'for_each',
      `\${{
          for dvo in ${certificate.fqn}.domain_validation_options : dvo.domain_name => {
            name   = dvo.resource_record_name
            record = dvo.resource_record_value
            type   = dvo.resource_record_type
          }
        }
      }`
    );

    // S3 bucket for the static assets
    const bucket = new S3Bucket(this, 'bucket', {
      forceDestroy: true,
      bucket: bucketName,
    });

    const routingLambda = new Lambda(this, 'edge_handler', {
      runtime: 'nodejs18.x',
      handler: 'index.handler',
      sourcePath: resolve('./src/origin-request-handler/'),
      functionName: `${siteIdentifier}_OriginRequestHandler`,
      lambdaAtEdge: true,
      attachPolicyJson: true,
      policyJson: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:ListBucket'],
            Resource: [bucket.arn, `${bucket.arn}/*`],
          },
          {
            Effect: 'Allow',
            Action: ['lambda:InvokeFunctionUrl', 'lambda:InvokeFunction'],
            Resource: ['arn:aws:lambda:*:*:function:*'],
            Condition: {
              StringEquals: {
                'aws:ResourceTag/site': siteIdentifier,
              },
            },
          },
        ],
      }),
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

    // NOTE: Use these like environment variables for our edge router
    const customHeaders = [];
    if (ssrHandlerFunctionArn) {
      customHeaders.push({
        name: 'ssr-handler-arn',
        value: ssrHandlerFunctionArn,
      });
    }

    new CloudfrontDistribution(this, 'cloudfront_distro', {
      enabled: true,
      aliases: [domainName, `*.${domainName}`],
      origin: [
        {
          domainName: bucket.bucketRegionalDomainName,
          originId: 's3_bucket',
          customHeader: customHeaders,
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
            lambdaArn: routingLambda.lambdaFunctionQualifiedArnOutput,
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
}
