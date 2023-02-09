import type { CloudFrontHeaders, CloudFrontResultResponse, CloudFrontRequestEvent, Context } from 'aws-lambda';
import '#internal/nitro/virtual/polyfill';
import { withQuery, getQuery } from 'ufo';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { join } from 'path';

const nitroApp = useNitroApp();
const client = new S3Client({});
const config = useRuntimeConfig();
const BUCKET = config.bucket;
const BUCKET_PATH_PREFIX = config.bucketPathPrefix;

export async function handler(event: CloudFrontRequestEvent, context: Context) {
  const request = event.Records[0].cf.request;
  const key = join(BUCKET_PATH_PREFIX, request.uri);
  console.log(key);
  try {
    const existsResponse = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    console.log(existsResponse.$metadata);
    if (existsResponse.$metadata.httpStatusCode === 200) {
      return request;
    }
    // in theory this can't happen, but just in case
    return {
      status: '404',
    };
  } catch (exc) {
    console.log(exc);
    const query = getQuery(request.querystring);
    const url = withQuery(request.uri, query);
    const method = request.method;
    const response = await nitroApp.localCall({
      body: request.body,
      url,
      method,
      headers: normalizeIncomingHeaders(request.headers),
      event,
      context,
      query,
    });
    return normalizeResponse(response);
  }
}

function normalizeIncomingHeaders(headers?: CloudFrontHeaders) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key, value.map((entry) => entry.value)])
  );
}

function normalizeResponse(response: Awaited<ReturnType<typeof nitroApp.localCall>>): CloudFrontResultResponse {
  const headers = Object.fromEntries(
    Object.entries(response.headers ?? {}).map(([key, value]) => {
      const newValue = [];
      if (Array.isArray(value)) {
        // loop and build the value
        for (const innerValue in value) {
          newValue.push({ value: innerValue });
        }
      } else if (value !== undefined) {
        newValue.push({ value });
      }
      return [key, newValue];
    })
  );
  return {
    body: response.body.toString(),
    status: response.status.toString(10),
    statusDescription: response.statusText,
    headers,
  };
}
