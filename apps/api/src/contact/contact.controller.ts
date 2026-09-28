import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ContactService } from './contact.service';
import { CreateContactInquiryDto } from './dto/create-contact-inquiry.dto';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /** Public - the marketing site's Contact Us form. No session exists here. */
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  submit(@Body() dto: CreateContactInquiryDto, @Req() req: Request) {
    return this.contact.submit(dto, req.headers.origin, req.ip);
  }
}
