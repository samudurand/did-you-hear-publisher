import React, { useState, ChangeEvent, FormEvent, useEffect } from 'react';
import './App.css';
import { Container, Form, Button, Alert, Row, Col } from 'react-bootstrap'; // Import Row and Col for layout
import axios from 'axios';
import {
    CognitoAccessToken,
    CognitoIdToken,
    CognitoRefreshToken,
    CognitoUser,
    CognitoUserPool,
    CognitoUserSession,
} from 'amazon-cognito-identity-js';

const userPool = new CognitoUserPool({
    UserPoolId: process.env.REACT_APP_COGNITO_USER_POOL_ID || "missing",
    ClientId: process.env.REACT_APP_COGNITO_USER_POOL_CLIENT_ID || "missing",
});

const cognitoUIUrl = process.env.REACT_APP_COGNITO_UI_URL || "missing";
const redirectUri = process.env.REACT_APP_WEBSITE_URL || 'missing';

function App() {
    const [titleValue, setTitleValue] = useState('');
    const [contentValue, setContentValue] = useState('');
    const [selectedContentType, setSelectedContentType] = useState('NEW');
    const [errorMessage, setErrorMessage] = useState('');
    const [token, setToken] = useState('');
    const [pageUrl, setPageUrl] = useState('');
    const [generatedSummary, setGeneratedSummary] = useState('');

    useEffect(() => {
        const cognitoUser = userPool.getCurrentUser();
    
        if (cognitoUser) {
            cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
                if (err || !session || !session.isValid()) {
                    redirectToCognitoLogin();
                } else {
                    console.error('session set')
                    setToken(session.getIdToken().getJwtToken());
                }
            });
        } else {
            checkUrlForTokens();
        }
    }, []);

    const checkUrlForTokens = () => {
        // Parse the tokens from URL
        const hash = window.location.hash;
        const params = new URLSearchParams(hash.substring(1));
    
        const idToken = params.get('id_token');
        const accessToken = params.get('access_token') || "missing";
        const refreshToken = params.get('refresh_token') || "missing";
    
        if (idToken) {
            // Store tokens (localStorage, cookie, etc.)
            // Set session manually
            const cognitoUser = new CognitoUser({
                Username: 'dummy', // Since we are not using the username/password flow
                Pool: userPool,
            });
            
            // Example to set the session manually:
            const session = new CognitoUserSession({
                IdToken: new CognitoIdToken({ IdToken: idToken }),
                AccessToken: new CognitoAccessToken({ AccessToken: accessToken }),
                RefreshToken: new CognitoRefreshToken({ RefreshToken: refreshToken }),
            });
    
            // Store the session if needed
            cognitoUser.setSignInUserSession(session);
            setToken(idToken);
        } else {
            redirectToCognitoLogin();
        }
    };

    const redirectToCognitoLogin = () => {
        window.location.href = `${cognitoUIUrl}/login?client_id=${userPool.getClientId()}&response_type=token&scope=openid+profile&redirect_uri=${encodeURIComponent(redirectUri)}`;
    };

    const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
        setTitleValue(event.target.value);
    };

    const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        setContentValue(event.target.value);
    };

    const handleContentTypeChange = (event: ChangeEvent<HTMLInputElement>) => {
        setSelectedContentType(event.target.value);
    };

    const handlePageUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
        setPageUrl(event.target.value);
    };

    const handleUrlSubmit = async (event: FormEvent) => {
        event.preventDefault();
        
        try {
            const requestBody = {
                url: pageUrl
            };

            const response = await axios.post('/api/summary/', requestBody, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response.status === 200) {
                setGeneratedSummary(response.data.summary);
            } else {
                setErrorMessage('An error occurred generating the summary. Please try again.');
            }
        } catch (error) {
            console.error('Error:', error);
            setErrorMessage('An unexpected error occurred generating the summary. Please try again.');
        }
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();

        if (!token) {
            setErrorMessage('You must be logged in to submit an item.');
            return;
        }

        try {
            const requestBody = {
                title: titleValue,
                content: contentValue,
                itemType: selectedContentType,
            };

            const response = await axios.post('/api/creator/', requestBody, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (response.status === 200) {
                setTitleValue('');
                setContentValue('');
                setSelectedContentType('NEW');

                setErrorMessage('');
            } else {
                setErrorMessage('An error occurred. Please try again.');
            }
        } catch (error) {
            console.error('Error:', error);
            setErrorMessage('An unexpected error occurred. Please try again.');
        }
    };

    return (
        <Container className="App">
            <header className="App-header">
                <Form className="FormContainer" onSubmit={handleUrlSubmit}>
                    <Form.Group controlId="formPageUrl" className="mb-3 d-flex align-items-center">
                        <Form.Control
                            type="text"
                            value={pageUrl}
                            onChange={handlePageUrlChange}
                            placeholder="Enter page URL to generate summary suggestions"
                            className="me-2 flex-grow-1"
                        />
                        <Button variant="secondary" type="submit" className="SummaryButton">
                            Generate
                        </Button>
                    </Form.Group>
                    {generatedSummary && (
                        <Form.Group controlId="generatedSummary" className="mb-3 d-flex align-items-center">
                            <Form.Text className="form-control bg-light me-2 flex-grow-1">
                                {generatedSummary}
                            </Form.Text>
                            <Button variant="dark" type="submit" className="SummaryButton">
                                Apply
                            </Button>
                        </Form.Group>
                    )}                    
                </Form>

                <hr className="hr Separator" />

                <Form className="FormContainer" onSubmit={handleSubmit}>

                    <Form.Group controlId="formTitle">
                        {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

                        <Form.Control
                            type="text"
                            value={titleValue}
                            onChange={handleTitleChange}
                            placeholder="Title"
                            className="mb-3"
                        />
                    </Form.Group>

                    <Form.Group controlId="formContent">
                        <Form.Control
                            as="textarea"
                            value={contentValue}
                            onChange={handleContentChange}
                            placeholder="Content"
                            rows={4}
                            className="mb-3"
                        />
                    </Form.Group>

                    <Row className="mb-3">
                        <Col>
                            <Form.Check
                                inline
                                type="radio"
                                label="🆕 New"
                                name="messageType"
                                value="NEW"
                                checked={selectedContentType === 'NEW'}
                                onChange={handleContentTypeChange}
                            />
                            <Form.Check
                                inline
                                type="radio"
                                label="📘 Article"
                                name="messageType"
                                value="ARTICLE"
                                checked={selectedContentType === 'ARTICLE'}
                                onChange={handleContentTypeChange}
                            />
                            <Form.Check
                                inline
                                type="radio"
                                label="🤓 Feature"
                                name="messageType"
                                value="FEATURE"
                                checked={selectedContentType === 'FEATURE'}
                                onChange={handleContentTypeChange}
                            />
                            <Form.Check
                                inline
                                type="radio"
                                label="📚 Training"
                                name="messageType"
                                value="TRAINING"
                                checked={selectedContentType === 'TRAINING'}
                                onChange={handleContentTypeChange}
                            />
                            <Form.Check
                                inline
                                type="radio"
                                label="🌎 Miscellaneous"
                                name="messageType"
                                value="MISC"
                                checked={selectedContentType === 'MISC'}
                                onChange={handleContentTypeChange}
                            />
                        </Col>
                    </Row>

                    <Button className="SubmitButton" variant="success" type="submit">
                        Submit
                    </Button>
                </Form>
            </header>
        </Container>
    );
}

export default App;
