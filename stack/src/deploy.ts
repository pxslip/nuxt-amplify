import { LambdaAlias } from '@cdktf/provider-aws/lib/lambda-alias';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Lambda } from '@gen/lambda';
import { TerraformIterator, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';

interface DeployStackConfig {
  ssrHandlerFunctionName: string;
  ssrHandlerFunctionPath: string;
  bucketName: string;
  ssrHandlerFunctionHandler?: string;
  alias?: string;
}

export class DeployStack extends TerraformStack {
  constructor(
    scope: Construct,
    id: string,
    {
      ssrHandlerFunctionName,
      ssrHandlerFunctionPath,
      bucketName,
      ssrHandlerFunctionHandler = 'index.handler',
      alias = 'main',
    }: DeployStackConfig
  ) {
    super(scope, id);
    new AwsProvider(this, 'aws_provider', {
      profile: process.env.AWS_PROFILE,
    });
    const ssrLambda = new Lambda(this, 'ssr_handler', {
      runtime: 'nodejs18.x',
      handler: ssrHandlerFunctionHandler,
      sourcePath: ssrHandlerFunctionPath,
      functionName: ssrHandlerFunctionName,
    });

    new LambdaAlias(this, 'ssr_handler_main_alias', {
      functionName: ssrLambda.lambdaFunctionNameOutput,
      functionVersion: ssrLambda.lambdaFunctionVersionOutput,
      name: alias,
    });

    const pubPath = resolve('..', '.output', 'public');
    // add the lambda handler to the server output
    const files = Array.from(this.walk(pubPath)).map((value) => value);
    const iterator = TerraformIterator.fromList(files);
    new S3Object(this, 'nuxt_bucket_public_objects', {
      forEach: iterator,
      bucket: bucketName,
      key: `${alias}${iterator.value}`,
      source: `${pubPath}${iterator.value}`,
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
