import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  
  app.enableCors({
    origin: [
      'http://localhost:3000', // Next.js dev frontend
      'https://your-frontend-domain.com', 
    ],
    credentials: true,
  });

  
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 Backend running at http://localhost:${port}/api`);
}
bootstrap();
