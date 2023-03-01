// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { App, CloudBackend, NamedCloudWorkspace } from 'cdktf';
import { config } from 'dotenv';
import { CoreStack } from './core';

// Load the .env file
config();

const app = new App();
const domainName = process.env.DOMAIN_NAME!;
const siteIdentifier = process.env.SITE_IDENTIFIER!;
const validationDomain = process.env.VALIDATION_DOMAIN!;
const gitHubPath = process.env.GITHUB_PATH!;
const coreStack = new CoreStack(app, 'core', {
  siteIdentifier,
  domainName,
  validationDomain,
  gitHubPath,
});
new CloudBackend(coreStack, {
  hostname: process.env.TERRAFORM_HOST,
  organization: process.env.TERRAFORM_ORG!,
  workspaces: new NamedCloudWorkspace(process.env.TERRAFORM_WORKSPACE!),
});
app.synth();
