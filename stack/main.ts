// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { App, TerraformVariable } from 'cdktf';
import { config } from 'dotenv';
import { CoreStack } from './core.js';

// Load the .env file
config();

const app = new App();
const domainName = process.env.DOMAIN_NAME!;
const siteIdentifier = process.env.SITE_IDENTIFIER!;
const gitHubPath = process.env.GITHUB_PATH!;

new CoreStack(app, 'core', {
	siteIdentifier,
	domainName,
	gitHubPath,
});
app.synth();
