// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { App, CloudBackend, NamedCloudWorkspace } from 'cdktf';
import { config } from 'dotenv';
import { resolve } from 'path';
import { CoreStack } from './core';
import { DeployStack } from './deploy';

// Load the .env file
config();

const app = new App();
const domainName = 'nux-aws.pxslip.com';
const siteIdentifier = 'NuxtOnAWS';
const ssrHandlerFunctionName = `${siteIdentifier}_SSRHandler`;
const coreStack = new CoreStack(app, 'core', {
  siteIdentifier,
  domainName,
  validationDomain: 'pxslip.com',
  ssrHandlerFunctionName,
});
new CloudBackend(coreStack, {
  hostname: process.env.TERRAFORM_HOST,
  organization: process.env.TERRAFORM_ORG!,
  workspaces: new NamedCloudWorkspace(process.env.TERRAFORM_WORKSPACE!),
});

const deployStack = new DeployStack(app, 'deploy', {
  ssrHandlerFunctionName,
  ssrHandlerFunctionPath: resolve('../.output/server'),
  bucketName: domainName,
});
new CloudBackend(deployStack, {
  hostname: process.env.TERRAFORM_HOST,
  organization: process.env.TERRAFORM_ORG!,
  workspaces: new NamedCloudWorkspace('nuxt-aws_deploy'),
});
app.synth();
