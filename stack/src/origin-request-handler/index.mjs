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
  console.log(request);
  // subdomain value
  const subdomain = request.headers.host[0].value.split('.')[0];
  const prefix = subdomain.startsWith('dev-') ? subdomain : 'main';
  const key = join(prefix, request.uri);
  try {
    const existsResponse = await s3.send(new HeadObjectCommand({ Bucket: request.origin.s3.domainName, Key: key }));
    if (existsResponse.$metadata.httpStatusCode === 200) {
      request.uri = `/${key}`;
      request.origin.s3.path = `/${key}`;
      return request;
    }
  } catch (exc) {
    // get the lambda arn header
    const arn = request.origin.s3.customHeaders['ssr-handler-arn'][0].value;

    if (arn) {
      const lambdaResponse = await lambda.send(
        new InvokeCommand({
          FunctionName: arn,
          Qualifier: prefix,
          InvocationType: InvocationType.RequestResponse,
          Payload: JSON.stringify(request),
        })
      );
      const response = JSON.parse(new TextDecoder().decode(lambdaResponse.Payload));
      response.status = `${response.statusCode}`;
      const newHeaders = {};
      for (const name in response.headers) {
        newHeaders[name] = [{ value: response.headers[name] }];
      }
      response.headers = newHeaders;
      console.log(Object.keys(response));
      console.log(response);
      return response;
    }
  }
  // in theory this can't happen, but just in case
  return {
    status: '404',
  };
}
