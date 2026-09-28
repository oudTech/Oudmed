import { Module } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { TurnstileService } from './turnstile.service';

@Module({
  controllers: [ContactController],
  providers: [ContactService, TurnstileService],
})
export class ContactModule {}
