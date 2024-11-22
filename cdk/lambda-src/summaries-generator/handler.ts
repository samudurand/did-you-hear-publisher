import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import middy from '@middy/core';

import { lambdaHandler, logger } from './handlerImpl';

export const handler = middy(lambdaHandler)
    .use(injectLambdaContext(logger, { logEvent: true }));
    
