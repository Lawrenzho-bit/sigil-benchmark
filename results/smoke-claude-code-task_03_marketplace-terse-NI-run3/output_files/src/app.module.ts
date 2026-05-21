import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { configValidationSchema } from './config/config.schema';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthModule } from './common/health/health.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { ListingsModule } from './modules/listings/listings.module';
import { SearchModule } from './modules/search/search.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { TaxModule } from './modules/tax/tax.module';
import { AdminModule } from './modules/admin/admin.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: configValidationSchema }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Strip auth headers / cookies from logs (PCI SAQ-A + GDPR).
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    // Drives the weekly payout cron (see PayoutsService).
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    StripeModule,
    StorageModule,
    // Domain modules.
    AuthModule,
    UsersModule,
    SellersModule,
    ListingsModule,
    SearchModule,
    CartModule,
    CheckoutModule,
    OrdersModule,
    ReviewsModule,
    MessagingModule,
    DisputesModule,
    PayoutsModule,
    TaxModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
