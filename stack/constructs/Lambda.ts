import { DataArchiveFile } from '@cdktf/provider-archive/lib/data-archive-file';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { IamRole, IamRoleInlinePolicy } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region';
import { Construct } from 'constructs';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider/index.js';

const codeFile = `export function handler() {
  return {
    body: 'Default SSR Handler Called',
    headers: {},
    status: 200,
    statusText: 'ok',
  };
}
`;
const emptyCodePath = '${path.module}/lambda-default.zip';

export interface LambdaOptions {
	functionName: string;
	code?: DataArchiveFile;
	inlinePolicies?: IamRoleInlinePolicy[];
	managedPolicies?: string[];
	memory?: number;
	runtime?: 'nodejs18.x' | string;
	timeout?: number;
	environment?: Record<string, string>;
	logRetention?: number;
	handler?: string;
	edge?: boolean;
	provider?: AwsProvider;
	publish?: boolean;
}

export class Lambda extends Construct {
	#logGroup;
	#role;
	#lambda;
	constructor(
		scope: Construct,
		id: string,
		{
			functionName,
			code,
			logRetention = 14,
			inlinePolicies = [],
			managedPolicies,
			memory = 128,
			timeout = 5,
			runtime = 'nodejs18.x',
			environment,
			handler = 'index.handler',
			edge = false,
			provider,
			publish = false,
		}: LambdaOptions
	) {
		super(scope, id);

		if (edge) {
			const err = Error('Lambda@Edge requires that the lambda be created in the us-east-1 region');
			if (provider) {
				if (provider.region !== 'us-east-1') {
					throw err;
				}
			} else {
				const region = new DataAwsRegion(this, 'aws_region');
				if (region.name !== 'us-east-1') {
					throw err;
				}
			}
			// set publish to true as that is required by Cloudfront Lambda@Edge functions
			publish = true;
		}
		let ignoreHash = false;
		if (!code) {
			code = new DataArchiveFile(this, 'code_archive', {
				type: 'zip',
				sourceContent: codeFile,
				sourceContentFilename: 'index.mjs',
				outputPath: emptyCodePath,
			});
			ignoreHash = true;
		}

		this.#logGroup = new CloudwatchLogGroup(this, 'log_group', {
			name: `/aws/lambda/${edge ? 'us-east-1.' : ''}${functionName}`,
			retentionInDays: logRetention,
		});

		const services = ['lambda.amazonaws.com'];
		if (edge) {
			services.push('edgelambda.amazonaws.com');
		}

		this.#role = new IamRole(this, 'iam_role', {
			name: `${functionName}_Role`,
			assumeRolePolicy: JSON.stringify({
				Version: '2012-10-17',
				Statement: [
					{
						Sid: 'LambdaAssumeRole',
						Action: 'sts:AssumeRole',
						Effect: 'Allow',
						Principal: {
							Service: services,
						},
					},
				],
			}),
		});

		inlinePolicies.push({
			name: `${functionName}_logs`,
			policy: JSON.stringify({
				Statement: [
					{
						Action: ['logs:PutLogEvents', 'logs:CreateLogStream', 'logs:CreateLogGroup'],
						Effect: 'Allow',
						Resource: [`${this.logGroup.arn}:*:*`, `${this.logGroup.arn}:*`],
					},
				],
				Version: '2012-10-17',
			}),
		});

		for (let i = 0; i < inlinePolicies.length; i++) {
			const { policy } = inlinePolicies[i];
			if (policy) {
				new IamRolePolicy(this, `iam_role_policy_${i}`, {
					role: this.role.id,
					policy,
				});
			}
		}

		// if there are inline policies, attach them
		if (managedPolicies) {
			this.#role.managedPolicyArns = managedPolicies;
		}

		this.#lambda = new LambdaFunction(this, 'function', {
			functionName: functionName,
			role: this.#role.arn,
			filename: code.outputPath,
			sourceCodeHash: code.outputBase64Sha256,
			handler: handler,
			memorySize: memory,
			timeout: edge ? Math.min(30, timeout) : timeout,
			runtime,
			provider: provider,
			publish: true,
		});

		if (ignoreHash) {
			this.#lambda.lifecycle = {
				ignoreChanges: ['source_code_hash'],
			};
		}

		if (environment) {
			this.#lambda.putEnvironment({ variables: environment });
		}
	}

	get lambda() {
		return this.#lambda;
	}

	get logGroup() {
		return this.#logGroup;
	}

	get role() {
		return this.#role;
	}
}
