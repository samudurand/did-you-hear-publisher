import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';  // Add this import
import * as iam from 'aws-cdk-lib/aws-iam';

import { WebappConfig } from '../../config/WebappConfig';

interface SummariesGeneratorLambdaProps {
    config: WebappConfig;
}

/**
 * Lambda that retrieves content from a URL and generates summaries
 * storing them in the infoItems DynamoDB table
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
            timeout: Duration.seconds(30),
            memorySize: 256,
            environment: {
                LOG_LEVEL: props.config.logLevel,
            }
        });

        // Add Bedrock permissions
        summariesGeneratorLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel'
            ],
            resources: ['*']
        }));

        this.lambda = summariesGeneratorLambda;
        this.lambdaUrl = summariesGeneratorLambda.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE,
        });
    }
}

