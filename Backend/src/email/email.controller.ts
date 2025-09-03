import { Controller, Get, Query } from '@nestjs/common';
import { EmailService } from './email.service';

@Controller('emails')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  // New test session (generate token + show mailbox)
  @Get('session/new')
  newSession() {
    return this.emailService.createSession();
  }

  // Get latest processed email for token
  @Get('latest')
  async latest(@Query('token') token: string) {
    return this.emailService.getLatestByToken(token);
  }

  // List all processed
  @Get()
  async listAll() {
    return this.emailService.listAll();
  }
}
