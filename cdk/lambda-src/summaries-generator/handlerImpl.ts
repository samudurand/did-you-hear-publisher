import { Logger } from '@aws-lambda-powertools/logger';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Lambda receiving URLs and returning AI-generated summaries of their content
 */

export const logger = new Logger({
    serviceName: 'summary-generator',
    logLevel: 'ERROR',
});

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

interface UrlRequest {
    url: string;
}

async function fetchPageContent(url: string): Promise<string> {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        
        // Remove common non-content elements
        $('script').remove();
        $('style').remove();
        $('nav').remove();
        $('footer').remove();
        $('header').remove();
        
        // Get the main content
        const content = $('main').text() || $('article').text() || $('body').text();
        return content.replace(/\s+/g, ' ').trim();
    } catch (error) {
        logger.error(`Error fetching URL content: ${error}`);
        throw new Error('Failed to fetch URL content');
    }
}

async function generateSummary(content: string): Promise<string> {
    try {
        const prompt = `Please provide a concise one or two sentence summary of this announcement or blog post: ${content}`;
        
        const command = new InvokeModelCommand({
            modelId: 'amazon.titan-text-express-v1',
            body: JSON.stringify({
                inputText: prompt,
                textGenerationConfig: {
                    maxTokenCount: 130, // Around 50 to 100 words
                    temperature: 0.7,
                    topP: 1
                }
            }),
            contentType: 'application/json',
        });

        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.completion.trim();
    } catch (error) {
        logger.error(`Error generating summary: ${error}`);
        throw new Error('Failed to generate summary');
    }
}

export async function lambdaHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
    logger.debug(`Received event: ${JSON.stringify(event)}`);
    
    if (event.requestContext.http.method !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method not allowed' }),
        };
    }

    try {
        const request: UrlRequest = JSON.parse(event.body || '');
        if (!request.url) {
            throw new Error('Missing URL');
        }

        logger.info(`Processing URL: ${request.url}`);
        
        // Fetch content from URL
        const content = await fetchPageContent(request.url);
        logger.debug(`Retrieved content length: ${content.length} characters`);
        
        // Generate summary using Bedrock
        const summary = await generateSummary(content);
        logger.debug(`Generated summary: ${summary}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                summary: summary,
                url: request.url
            }),
        };
    } catch (error) {
        logger.error(`Error processing content: ${error}`);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to process content' }),
        };
    }
}
