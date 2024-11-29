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
    logLevel: 'INFO',
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
        const prompt = `Context: Considering the following announcement \n
                        """${content}""" \n

                        Task: Write a short text of at most 3 sentences, sharing the feature that is being announced, as if you were describing the feature in a newsletter. 
                        Do not describe AWS services already existing prior to the new feature release.
                        `;

                        // const prompt = `Context: Considering the following announcement \n
                        // """${content}""" \n

                        // Task 1: Write a short message, sharing the feature that is being announced, as if you were describing the feature in a newsletter. The tone of the message should be professional and to the point, not trying to advertise the feature, but instead describe it objectively.
                        // Each message cannot contain more than 3 sentences.
                        // Do not describe AWS services already existing prior to the new feature release.

                        // Task 2: Take the result of task 1 and reformulate it to write 2 other messages with the same content but a different writing style and different tones.

                        // Return all 3 messages.
                        // `;
        // const prompt = `Context: Considering the following announcement \n
        //                 """${content}""" \n

        //                 Task: Write a short text sharing what feature is announced. As if a colleague was sharing the news with another colleague.\n
        //                 \n
        //                 Do not describe AWS services already existing prior to the new feature release.\n
        //                 Do not use terms like "Introducing" at the beginning of the text. \n                        
        //                 Do not mention if the feature is available via CLI or SDK. \n
        //                 Avoid too many repetitions of the same verbs. \n
        //                 Prefer single sentence texts, and never go beyond 3 sentences.
        //                 `;
        
        const command = new InvokeModelCommand({
            modelId: 'amazon.titan-text-express-v1',
            body: JSON.stringify({
                inputText: prompt,
                textGenerationConfig: {
                    maxTokenCount: 130, // Around 40 to 80 words
                    temperature: 0.4,
                    topP: 0.9
                }
            }),
            contentType: 'application/json',
        });

        const response = await bedrockClient.send(command);
        
        if (!response.body) {
            logger.error('Empty response received from Bedrock');
            throw new Error('Empty response from Bedrock');
        }

        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        const summary = responseBody.results?.[0]?.outputText;
        if (!summary) {
            logger.error(`Invalid response format from Bedrock: ${JSON.stringify(responseBody)}`);
            throw new Error('Invalid response format from Bedrock');
        }

        return summary.trim();
    } catch (error) {
        logger.error(`Error generating summary: ${error}`);
        if (error instanceof SyntaxError) {
            throw new Error('Failed to parse Bedrock response');
        }
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
        logger.info(`Generated summary: ${summary}`);

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
