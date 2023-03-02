import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { DataAwsCloudfrontCachePolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-cache-policy';
import { DataAwsCloudfrontOriginRequestPolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-origin-request-policy';
import { DataAwsCloudfrontResponseHeadersPolicy } from '@cdktf/provider-aws/lib/data-aws-cloudfront-response-headers-policy';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { Route53Zone } from '@cdktf/provider-aws/lib/route53-zone';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { TerraformIterator, TerraformOutput, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';
import { resolve } from 'path';
import { Lambda } from '@gen/lambda';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { DataAwsIamOpenidConnectProvider } from '@cdktf/provider-aws/lib/data-aws-iam-openid-connect-provider';
import { CloudfrontOriginAccessControl } from '@cdktf/provider-aws/lib/cloudfront-origin-access-control';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';

interface CoreStackConfiguration {
  /**
   * The domain of the site being created/hosted
   */
  domainName: string;
  /**
   * An identifier used to create/tag AWS resources
   */
  siteIdentifier: string;
  /**
   * A git pathspec-like string that defines which org/repo/branch|PR|environment can assume the deploy role e.g. organization/repository/
   */
  gitHubPath: string;
  /**
   * If the domain is not the root domain and it is desirable to use the root as the validation, set this
   */
  validationDomain?: string;
  /**
   * Override the name of the bucket to create
   */
  bucketName?: string;
}

export class CoreStack extends TerraformStack {
  constructor(
    scope: Construct,
    id: string,
    { siteIdentifier, domainName, validationDomain, bucketName, gitHubPath }: CoreStackConfiguration
  ) {
    super(scope, id);
    // define our connection to AWS, uses the environment variables to figure out the key/secret
    new AwsProvider(this, 'aws_provider', {
      profile: process.env.AWS_PROFILE,
    });
    validationDomain = validationDomain ?? domainName;
    bucketName = bucketName ?? domainName;

    // Get a reference to the GitHub OIDC provider
    const ghOidcProvider = new DataAwsIamOpenidConnectProvider(this, 'gh_iam_oidc_provider', {
      url: 'https://token.actions.githubusercontent.com',
    });

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

    // The SSR lambda and the user
    const ssrLambda = new Lambda(this, 'ssr_handler', {
      runtime: 'nodejs18.x',
      handler: 'index.handler',
      sourcePath: resolve('./src/ssr-handler'),
      functionName: `${siteIdentifier}_SSRHandler`,
      timeout: 30,
      ignoreSourceCodeHash: true,
    });

    const deployRole = new IamRole(this, 'deploy_role', {
      name: `${siteIdentifier}_DeployRole`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sts:AssumeRoleWithWebIdentity',
            Principal: {
              Federated: ghOidcProvider.arn,
            },
            Condition: {
              StringLike: {
                'token.actions.githubusercontent.com:sub': gitHubPath,
              },
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              },
            },
          },
        ],
      }),
      inlinePolicy: [
        {
          name: 'NuxtSiteDeploy',
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:PutObject', 's3:GetObject', 's3:ListBucket', 's3:DeleteObject', 's3:GetBucketLocation'],
                Resource: [bucket.arn, `${bucket.arn}/*`],
              },
              {
                Effect: 'Allow',
                Action: ['lambda:UpdateFunctionCode', 'lambda:UpdateAlias', 'lambda:CreateAlias'],
                Resource: [ssrLambda.lambdaFunctionArnOutput],
              },
            ],
          }),
        },
      ],
    });
    new TerraformOutput(this, 'deploy_role_arn', {
      value: deployRole.arn,
    });

    const routingLambda = new Lambda(this, 'edge_handler', {
      runtime: 'nodejs18.x',
      handler: 'index.handler',
      sourcePath: resolve('./src/origin-request-handler/'),
      functionName: `${siteIdentifier}_OriginRequestHandler`,
      timeout: 30,
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
            Resource: [ssrLambda.lambdaFunctionArnOutput, `${ssrLambda.lambdaFunctionArnOutput}*`],
          },
        ],
      }),
    });

    const originRequestPolicy = new DataAwsCloudfrontOriginRequestPolicy(this, 'origin_request_policy', {
      name: 'Managed-AllViewer',
    });
    // const cacheOptimizedCachePolicy = new DataAwsCloudfrontCachePolicy(this, 'cache_optimized_cache_policy', {
    //   name: 'Managed-CachingOptimized',
    // });
    const cacheDisabledCachePolicy = new DataAwsCloudfrontCachePolicy(this, 'cache_disabled_cache_policy', {
      name: 'Managed-CachingDisabled',
    });
    const secHeadersPolicy = new DataAwsCloudfrontResponseHeadersPolicy(this, 'security_header_response_policy', {
      name: 'Managed-SecurityHeadersPolicy',
    });

    const oac = new CloudfrontOriginAccessControl(this, 'cloudfront_origin_access_control', {
      name: `${siteIdentifier}_OAC`,
      originAccessControlOriginType: 's3',
      signingBehavior: 'always',
      signingProtocol: 'sigv4',
    });

    const cloudfrontDistro = new CloudfrontDistribution(this, 'cloudfront_distro', {
      enabled: true,
      aliases: [domainName, `*.${domainName}`],
      origin: [
        {
          domainName: bucket.bucketRegionalDomainName,
          originId: 's3_bucket',
          originAccessControlId: oac.id,
          customHeader: [
            // Treat these like environment variables for the routing function
            {
              name: 'ssr-handler-arn',
              value: ssrLambda.lambdaFunctionArnOutput,
            },
            {
              name: 'base-domain',
              value: domainName,
            },
            {
              name: 'bucket-name',
              value: bucket.bucket,
            },
          ],
        },
      ],
      defaultCacheBehavior: {
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
        cachedMethods: ['GET', 'HEAD'],
        targetOriginId: 's3_bucket',
        viewerProtocolPolicy: 'redirect-to-https',
        cachePolicyId: cacheDisabledCachePolicy.id,
        originRequestPolicyId: originRequestPolicy.id,
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
    new S3BucketPolicy(this, 'bucket_policy', {
      bucket: bucket.id,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'cloudfront.amazonaws.com',
            },
            Action: 's3:GetObject',
            Resource: `${bucket.arn}/*`,
            Condition: {
              StringEquals: {
                'AWS:SourceArn': cloudfrontDistro.arn,
              },
            },
          },
        ],
      }),
    });
  }
}
