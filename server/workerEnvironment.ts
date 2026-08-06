import dotenv from 'dotenv';

// Only the worker is permitted to load the repository-root .env file. The app
// and storage initializer receive nonsecret configuration from their process
// environment and never gain access to provider credentials.
dotenv.config({quiet: true});
