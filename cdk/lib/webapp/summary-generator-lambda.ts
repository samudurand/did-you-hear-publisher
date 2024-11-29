import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';  // Add this import
import * as iam from 'aws-cdk-lib/aws-iam';

import { WebappConfig } from '../../config/WebappConfig';

interface SummariesGeneratorLambdaProps {
    config: WebappConfig;
    requestTimeout: Duration;
}

/**
 * Lambda function that processes content using Amazon Bedrock to generate summaries
 */
export class SummariesGeneratorLambda extends Construct {

    public readonly lambdaUrl: lambda.FunctionUrl;
    public readonly lambda: lambdaNode.NodejsFunction;

    constructor(scope: Construct, id: string, props: SummariesGeneratorLambdaProps) {
        super(scope, id);

        const summariesGeneratorLambda = new lambdaNode.NodejsFunction(this, 'summariesGeneratorLambda', {
            functionName: 'summariesGeneratorLambda',
            entry: 'lambda-src/summaries-generator/handler.ts',
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_18_X,
            timeout: props.requestTimeout,
            memorySize: 256,
            environment: {
                LOG_LEVEL: props.config.logLevel,
            }
        });

        summariesGeneratorLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel'
            ],
            resources: ['*']
        }));

        this.lambda = summariesGeneratorLambda;
        this.lambdaUrl = summariesGeneratorLambda.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.AWS_IAM,
        });
    }
}

