# Deployment

1. Deploy core stack

- S3 bucket for static file hosting
- Cloudfront Distro, origin is S3 bucket
- Route 53 Zone hosting `subdomain.site.com` - recommend using a subdomain based hosted zone with subdomain based NS configured to allow for PR/Branch based preview environments
- ACM cerficate using DNS based validation for `subdomain.site.com` this allows for generating custom certs as needed for PR/branch based previews
- Lambda function for Lambda@Edge origin routing, permissions policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
              "s3:GetObject",
              "s3:ListBucket"
            ],
            "Resource": [
              "arn:aws:s3:::static-bucket-name",
              "arn:aws:s3:::static-bucket-name/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
              "logs:PutLogEvents",
              "logs:CreateLogStream",
              "logs:CreateLogGroup"
            ],
            "Resource": [
              "arn:aws:logs:*:*:log-group:aws/site-name/OriginRequestRouter"
              "arn:aws:logs:*:*:log-group:aws/site-name/OriginRequestRouter/*:log-stream:*"
            ],
        },
        {
          "Effect": "Allow",
          "Action": ["lambda:InvokeFunctionUrl"],
          "Resource": "arn:aws:lambda:*:*:function:OriginRequestRouter"
        }
    ]
}
```

- SSR lambda with v1 of the code, execution role policies:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": [
              "logs:PutLogEvents",
              "logs:CreateLogStream",
              "logs:CreateLogGroup"
            ],
            "Effect": "Allow",
            "Resource": [
              "arn:aws:logs:*:*:log-group:aws/site-name/SSRHandler"
              "arn:aws:logs:*:*:log-group:aws/site-name/SSRHandler/*:log-stream:*"
            ],
        }
    ]
}
```

- IAM User, credentials only, policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:DeleteObject"],
      "Effect": "Allow",
      "Resource": ["arn:aws:s3:::static-bucket-name", "arn:aws:s3:::static-bucket-name/*"]
    },
    {
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:DeleteAlias",
        "lambda:PublishVersion",
        "lambda:CreateAlias",
        "lambda:CreateFunctionUrlConfig"
      ],
      "Effect": "Allow",
      "Resource": ["arn:aws:lambda:*:*:function:SSRHandler"]
    }
  ]
}
```

2. Deploy GitHub action
   _NOTE:_ This might be worth creating as a CodePipeline setup instead to remove the requirement of granting permissions to an external provider

- Trigger: On push to main or creation of PR
- Actions:
  - Build the site (yarn run build)
  - Update SSR lambda code (terraform lambda resource)
  - Sync the static content, use main or pr-## as bucket prefix
  - If this is a PR
    - Add a Route 53 CNAME pointing pr-##.main.ushmm.org to the Cloudfront distro
    - Update the cloudfront distro with the new alias (confirm this is necessary)
    - Add a new alias pr-## to the lambda pointing to the newest version of the code
