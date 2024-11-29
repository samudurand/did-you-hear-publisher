import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { WebsiteBucket } from './website-bucket';
import { ItemCreatorLambda } from './item-creator-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { WebappConfig } from '../../config/WebappConfig';
import { PublisherUserPool } from './publisher-cognito-user-pool';
import path = require('path');
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { SummariesGeneratorLambda } from './summary-generator-lambda';


export interface WebappInfraStackProps extends cdk.StackProps {
    account: string;
    config: WebappConfig;
}

/**
 * Deploys the Webapp infrastructure
 * Currently includes:
 * - a React UI hosted on S3
 * - a Lambda function creating items in DynamoDB via HTTP API calls
 * - a Lambda@Edge function for authentication against Cognito
 * - a CloudFront distribution redirecting to the website and the Lambda URL
 */
export class WebappInfraStack extends cdk.Stack {

    public readonly s3Bucket: s3.Bucket;
    public readonly cfDistribution: cloudfront.CloudFrontWebDistribution;
    public readonly infoItemsTable: dynamodb.Table;
    private readonly summaryGenerationTimeout: cdk.Duration = cdk.Duration.seconds(30);

    constructor(scope: Construct, id: string, props: WebappInfraStackProps) {
        super(scope, id, props);

        // S3 bucket hosting the website 
        const webappBucket = new WebsiteBucket(this, 'WebappBucket');
        this.s3Bucket = webappBucket.s3Bucket;
        this.infoItemsTable = this.createItemsTable();
        
        // Lambda handling new publications
        const itemCreator = new ItemCreatorLambda(this, 'ItemCreatorStack', {
            config: props.config,
            infoItemsTable: this.infoItemsTable,
        });
        const itemCreatorLambdaURL = getLambdaURL(itemCreator.lambdaUrl);
        
        // Lambda handling summaries generation
        const summariesGenerator = new SummariesGeneratorLambda(this, 'SummariesGeneratorLambda', {
            config: props.config,
            requestTimeout: this.summaryGenerationTimeout,
        });
        const summariesGeneratorLambdaURL = getLambdaURL(summariesGenerator.lambdaUrl);
        

        // Lambda@Edge function for authentication against Cognito
        const authFunction = this.createAuthEdgeFunction(itemCreator, summariesGenerator);

        // Cloudfront distribution redirecting to the website and the Lambda URL
        const webappCFDistribution = this.createCloudFrontDistribution(webappBucket, itemCreatorLambdaURL, summariesGeneratorLambdaURL, authFunction);
        const websiteURL = `https://${webappCFDistribution.distributionDomainName}`;

        // Authentication user pool
        const publisherUserPool = new PublisherUserPool(this, 'PublisherUserPoolStack', props.account, websiteURL);


        // Store User Pool Client ID in SSM Parameter Store and allow the edge function access
        const { publisherUserPoolIdParam, publisherUserPoolClientIdParam } = this.createUserPoolsParameters(publisherUserPool);
        authFunction.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['ssm:GetParameter'],
            resources: [
                publisherUserPoolIdParam.parameterArn,
                publisherUserPoolClientIdParam.parameterArn,
            ],
        }));
        
        // Outputs

        new cdk.CfnOutput(this, 'PublisherCognitoUserPoolId', {
            value: publisherUserPool.userPoolId,
        });
        new cdk.CfnOutput(this, 'PublisherCognitoUserPoolClientId', {
            value: publisherUserPool.userPoolClientId,
        });
        new cdk.CfnOutput(this, 'PublisherCognitoUIUrl', {
            value: `https://${publisherUserPool.hostedUIDomain}.auth.${this.region}.amazoncognito.com`,
        });
        new cdk.CfnOutput(this, 'WebsiteURL', {
            value: websiteURL,
        });
    }

    private createUserPoolsParameters(publisherUserPool: PublisherUserPool) {
        const publisherUserPoolIdParam = new ssm.StringParameter(this, 'PublisherUserPoolIdParam', {
            parameterName: '/publisher/user-pool-id',
            stringValue: publisherUserPool.userPoolId,
        });
        const publisherUserPoolClientIdParam = new ssm.StringParameter(this, 'PublisherUserPoolClientIdParam', {
            parameterName: '/publisher/user-pool-client-id',
            stringValue: publisherUserPool.userPoolClientId,
        });
        return { publisherUserPoolIdParam, publisherUserPoolClientIdParam };
    }

    private createCloudFrontDistribution(
        webappBucket: WebsiteBucket, 
        itemCreatorLambdaURL: string, 
        summariesGeneratorLambdaURL: string, 
        authFunction: cdk.aws_cloudfront.experimental.EdgeFunction
    ) {
        return new cloudfront.CloudFrontWebDistribution(this, 'WebappCFDistribution', {
            originConfigs: [
                {
                    s3OriginSource: {
                        s3BucketSource: this.s3Bucket,
                        originAccessIdentity: webappBucket.oai,
                    },
                    behaviors: [{
                        isDefaultBehavior: true,
                    }],
                },
                {
                    customOriginSource: {
                        domainName: itemCreatorLambdaURL,
                        originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
                    },
                    behaviors: [{
                        isDefaultBehavior: false,
                        pathPattern: '/api/creator/*',
                        allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
                        lambdaFunctionAssociations: [{
                            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
                            lambdaFunction: authFunction.currentVersion,
                            includeBody: true
                        }],
                    }],
                },
                {
                    customOriginSource: {
                        domainName: summariesGeneratorLambdaURL,
                        originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
                    },
                    behaviors: [{
                        isDefaultBehavior: false,
                        pathPattern: '/api/summary/*',
                        allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
                        lambdaFunctionAssociations: [{
                            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
                            lambdaFunction: authFunction.currentVersion,
                            includeBody: true
                        }],
                    }],
                },
            ],
        });
    }

    private createAuthEdgeFunction(itemCreator: ItemCreatorLambda, summariesGenerator: SummariesGeneratorLambda) {
        const authFunction = new cloudfront.experimental.EdgeFunction(this, 'CognitoAuthLambdaEdge', {
            handler: 'authEdge.handler',
            runtime: lambda.Runtime.NODEJS_16_X,
            code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda-src-edge/auth-edge'), {
                bundling: {
                    command: [
                        "bash",
                        "-c",
                        "npm install && cp -rT /asset-input/ /asset-output/",
                    ],
                    image: lambda.Runtime.NODEJS_16_X.bundlingImage,
                    user: "root",
                },
            }),
            currentVersionOptions: {
                removalPolicy: cdk.RemovalPolicy.DESTROY
            },
            timeout: this.summaryGenerationTimeout,
        });

        authFunction.addToRolePolicy(new PolicyStatement({
            sid: 'AllowInvokeFunctionUrl',
            effect: Effect.ALLOW,
            actions: ['lambda:InvokeFunctionUrl'],
            resources: [
                itemCreator.lambda.functionArn,
                summariesGenerator.lambda.functionArn
            ],
            conditions: {
                "StringEquals": { "lambda:FunctionUrlAuthType": "AWS_IAM" }
            }
        }));
        return authFunction;
    }

    private createItemsTable(): dynamodb.Table {
        return new dynamodb.Table(this, 'infoItemsTable', {
            partitionKey: {
                name: 'id',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'submissionDate',
                type: dynamodb.AttributeType.STRING
            },
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
    }
}

function getLambdaURL(lambdaUrl: lambda.FunctionUrl) {
    return cdk.Fn.select(2, cdk.Fn.split('/', lambdaUrl.url));
}
