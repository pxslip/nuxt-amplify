import { Sha256 } from '@aws-crypto/sha256-universal';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetFunctionUrlConfigCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { join } from 'node:path';
import { SignatureV4 } from '@smithy/signature-v4';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { HttpRequest } from '@smithy/protocol-http';
import { CloudFrontRequest, CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';
import { parseQueryString } from '@smithy/querystring-parser';

export async function handler(event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> {
	const request = event.Records[0].cf.request;
	const hostParts = request.headers.host[0].value.split('.');
	const prefix = hostParts.length === 4 ? hostParts[0] : 'main';
	const key = join(prefix, request.uri);
	if (request.origin?.s3) {
		const bucket = request.origin.s3.customHeaders['bucket-name'][0].value;
		const region = request.origin.s3.customHeaders['resource-region'][0].value;
		// get a signer
		const signer = new SignatureV4({
			credentials: fromNodeProviderChain(),
			region,
			service: 'edgelambda',
			sha256: Sha256,
		});
		try {
			const s3 = new S3Client({ region });
			const existsResponse = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
			if (existsResponse.$metadata.httpStatusCode === 200) {
				request.origin.s3.path = `/${prefix}`;
				request.headers.host[0].value = request.origin.s3.domainName;
				return await signCloudfrontRequest(request, signer);
			}
		} catch (exc) {
			// get the lambda arn header
			const arn = request.origin.s3.customHeaders['ssr-handler-arn'][0].value;
			if (arn) {
				const lambda = new LambdaClient({ region });
				try {
					const lambdaUrlConfig = await lambda.send(
						new GetFunctionUrlConfigCommand({
							FunctionName: arn,
							Qualifier: prefix,
						})
					);
					if (lambdaUrlConfig.$metadata.httpStatusCode === 200) {
						if (lambdaUrlConfig.FunctionUrl) {
							const url = new URL(lambdaUrlConfig.FunctionUrl);
							request.headers.host[0].value = url.hostname;
							request.origin = {
								custom: {
									domainName: url.hostname,
									port: 443,
									protocol: 'https',
									sslProtocols: ['TLSv1.2'],
									readTimeout: 30,
									keepaliveTimeout: 5,
									path: '',
									customHeaders: {},
								},
							};
							const signedRequest = await signCloudfrontRequest(request, signer);
							console.log(JSON.stringify(signedRequest));
							return signedRequest;
						}
					}
				} catch (exc) {
					console.error(JSON.stringify(exc));
				}
			}
		}
	}
	// in theory this can't happen, but just in case
	return {
		status: '404',
	};
}
/**
 * generic signing code for cloudfront requests
 */
async function signCloudfrontRequest(request: CloudFrontRequest, signer: SignatureV4) {
	const headers = Object.fromEntries(
		Object.entries(request.headers).map((header) => {
			return [header[0], header[1][0].value];
		})
	);
	const path = `${request.origin?.s3?.path ?? request.origin?.custom?.path}/${request.uri}`;
	const signable = new HttpRequest({
		method: request.method,
		protocol: 'https',
		hostname: request.headers.host[0].value,
		port: 443,
		body: request.body,
		headers,
		path: path.startsWith('/') ? path : `/${path}`,
		query: parseQueryString(request.querystring),
	});
	const newRequest = await signer.sign(signable);
	for (const header in newRequest.headers) {
		if (!request.headers[header]) {
			request.headers[header] = [{ value: '' }];
		}
		request.headers[header][0].value = newRequest.headers[header];
	}
	return request;
}
