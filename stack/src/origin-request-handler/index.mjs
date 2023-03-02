import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { join } from 'path';

const s3 = new S3Client({});
const lambda = new LambdaClient({});

/**
 *
 * @param {import('aws-lambda').CloudFrontRequestEvent} event
 * @param {import('aws-lambda').Context} context
 * @returns
 */
export async function handler(event, context) {
  const request = event.Records[0].cf.request;
  console.log(JSON.stringify(event));
  console.log(JSON.stringify(context));
  const subdomain = request.headers.host[0].value.replace(request.origin.s3.customHeaders['base-domain'][0].value, '');
  const prefix = subdomain.length ? subdomain : 'main';
  const key = join(prefix, request.uri);
  const bucket = request.origin.s3.customHeaders['bucket-name'][0].value;
  try {
    const existsResponse = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    console.log(JSON.stringify(existsResponse));
    if (existsResponse.$metadata.httpStatusCode === 200) {
      request.uri = `/${key}`;
      request.headers.host[0].value = `${bucket}.s3.amazonaws.com`;
      return request;
    }
  } catch (exc) {
    // get the lambda arn header
    const arn = request.origin.s3.customHeaders['ssr-handler-arn'][0].value;
    if (arn) {
      const ssrRequest = {
        path: request.uri,
        httpMethod: request.method,
        headers: request.headers,
        body: request.body,
      };
      const lambdaResponse = await lambda.send(
        new InvokeCommand({
          FunctionName: arn,
          Qualifier: prefix,
          InvocationType: InvocationType.RequestResponse,
          Payload: JSON.stringify(ssrRequest),
        })
      );
      const response = JSON.parse(new TextDecoder().decode(lambdaResponse.Payload));
      response.status = `${response.statusCode}`;
      const newHeaders = {};
      for (const name in response.headers) {
        newHeaders[name] = [{ value: response.headers[name] }];
      }
      response.headers = newHeaders;
      return response;
    }
  }
  // in theory this can't happen, but just in case
  return {
    status: '404',
  };
}
