import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetFunctionUrlConfigCommand, InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { join } from 'node:path';

const s3 = new S3Client({ region: 'us-east-1' });
const lambda = new LambdaClient({ region: 'us-east-1' }); // the main SSR handler lives in us-east-1

/**
 *
 * @param {import('aws-lambda').CloudFrontRequestEvent} event
 * @param {import('aws-lambda').Context} context
 * @returns
 */
export async function handler(event, context) {
	const request = event.Records[0].cf.request;
	const subdomain = request.headers.host[0].value.split('.')[0];
	const prefix = subdomain.length ? subdomain : 'main';
	const key = join(prefix, request.uri);
	const bucket = request.origin.s3.customHeaders['bucket-name'][0].value;
	try {
		const existsResponse = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		if (existsResponse.$metadata.httpStatusCode === 200) {
			request.uri = `/${key}`;
			request.headers.host[0].value = `${bucket}.s3.amazonaws.com`;
			return request;
		}
	} catch (exc) {
		// get the lambda arn header
		const arn = request.origin.s3.customHeaders['ssr-handler-arn'][0].value;
		if (arn) {
			const lambdaUrlConfig = await lambda.send(
				new GetFunctionUrlConfigCommand({
					FunctionName: arn,
					Qualifier: prefix,
				})
			);
			if (lambdaUrlConfig.$metadata.httpStatusCode === 200) {
				if (lambdaUrlConfig.FunctionUrl) {
					const url = new URL(lambdaUrlConfig.FunctionUrl);
					request.origin = {
						custom: {
							domainName: url.hostname,
							port: url.port,
							protocol: url.protocol,
							sslProtocols: ['TLSv1.2'],
							readTimeout: 30,
						},
					};
					return request;
				}
			}
		}
	}
	// in theory this can't happen, but just in case
	return {
		status: '404',
	};
}
