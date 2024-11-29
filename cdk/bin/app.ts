#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

import * as fullConfig from '../config.json';
import { WebappDeploymentStack } from '../lib/webapp/webapp-deployment-stack';
import { WebappInfraStack } from '../lib/webapp/webapp-infra-stack';
import { PublisherStack } from '../lib/publishers/publisher-stack';
import * as assert from 'assert';

const LOCAL_ENV = 'local';
const DEV_ENV = 'dev';
const PROD_ENV = 'prod';

const app = new cdk.App();

// Retrieve config from environment
const environment = app.node.tryGetContext('env') as string;
const config = getConfig(environment);

const webappConfig = config.webapp;
const publishersConfig = config.publishers;

const appEnv = getApplicationEnvironment(environment);


// App setup

const webappInfraStack = new WebappInfraStack(app, 'WebappInfraStack', {
   account: appEnv.account,
   config: webappConfig,
   env: appEnv, // DO NOT REMOVE (necessary to make sure no cross-env situation happens)
});

new WebappDeploymentStack(app, 'WebappStack', {
   cfDistribution: webappInfraStack.cfDistribution,
   env: appEnv,
   s3Bucket: webappInfraStack.s3Bucket,
});

new PublisherStack(app, 'PublicationsHandlerStack', {
   env: appEnv,
   config: publishersConfig,
   infoItemsTable: webappInfraStack.infoItemsTable,
});


// Helpers

function getApplicationEnvironment(environment: string) {
   let account;
   let region;
   if (environment == PROD_ENV) {
      account = process.env.PROD_ACCOUNT;
      assert.ok(account, 'The "PROD_ACCOUNT" environment variable is required');

      region = process.env.PROD_REGION;
      assert.ok(region, 'The "PROD_REGION" environment variable is required');
   } else if (environment == DEV_ENV) {
      account = process.env.DEV_ACCOUNT;
      assert.ok(account, 'The "DEV_ACCOUNT" environment variable is required');

      region = process.env.DEV_REGION;
      assert.ok(region, 'The "DEV_REGION" environment variable is required');
   } else {
      account = "0000000000000000000";
      region = "eu-central-1";
   }

   console.log(`Using account ${account} and region ${region}`);
   return { account, region };
}

function getConfig(environment: string) {
   if (environment !== LOCAL_ENV && environment !== DEV_ENV && environment !== PROD_ENV) {
      throw new Error(`Context value "env" must one of [${LOCAL_ENV}, ${DEV_ENV}, ${PROD_ENV}], but was [${environment}].`);
   }

   return fullConfig[environment];
}

