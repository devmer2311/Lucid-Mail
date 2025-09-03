import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmailDocument = Email & Document;

@Schema({ timestamps: true })
export class Email extends Document {
  @Prop({ type: String })
  subject!: string;

  @Prop({ type: String })
  subjectToken!: string;

  @Prop({ type: Object })
  from!: Record<string, any>; // e.g. { address: "...", name: "..." }

  @Prop({ type: [Object] })
  to!: Record<string, any>[]; // array of recipients

  @Prop({ type: Date })
  date!: Date;

  @Prop({ type: String })
  rawHeaders!: string;

  @Prop({ type: [Object] })
  receivingChain!: Record<string, any>[]; // list of servers passed

  @Prop({ 
    type: Object 
  })
  esp!: { type: string; confidence: number; signals: string[] };

  @Prop({ type: Date, default: Date.now })
  processedAt!: Date;
}

export const EmailSchema = SchemaFactory.createForClass(Email);
