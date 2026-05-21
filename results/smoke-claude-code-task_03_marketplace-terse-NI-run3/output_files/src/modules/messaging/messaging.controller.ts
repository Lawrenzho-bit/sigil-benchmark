import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { MessagingService } from './messaging.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class StartConversationDto {
  @ApiProperty()
  @IsUUID()
  otherUserId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  listingId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orderId?: string;
}

class SendMessageDto {
  @ApiProperty()
  @IsString()
  @Length(1, 4000)
  body!: string;
}

@ApiTags('messaging')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.messaging.listConversations(user.id);
  }

  @Post()
  start(@CurrentUser() user: AuthUser, @Body() dto: StartConversationDto) {
    return this.messaging.startConversation(user.id, dto.otherUserId, {
      listingId: dto.listingId,
      orderId: dto.orderId,
    });
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messaging.getMessages(user.id, id);
  }

  @Post(':id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.messaging.sendMessage(user.id, id, dto.body);
  }
}
