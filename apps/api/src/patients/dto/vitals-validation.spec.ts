import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVitalsDto } from './clinical.dto';
import { UpdatePatientDto } from './patient.dto';

async function messagesFor(dto: object) {
  const errors = await validate(dto as any);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateVitalsDto validation messages (FUNC-3)', () => {
  it('rejects a non-integer height with a specific message', async () => {
    const dto = plainToInstance(CreateVitalsDto, { heightCm: 172.5 });
    const messages = await messagesFor(dto);
    expect(messages).toContain('Height must be a whole number in cm');
  });

  it('accepts a whole-number height', async () => {
    const dto = plainToInstance(CreateVitalsDto, { heightCm: 172 });
    const messages = await messagesFor(dto);
    expect(messages.some((m) => m.includes('Height'))).toBe(false);
  });

  it('rejects blood glucose over 60 with the mmol/L-vs-mg/dL message', async () => {
    const dto = plainToInstance(CreateVitalsDto, { bloodGlucose: 108 }); // a plausible mg/dL value
    const messages = await messagesFor(dto);
    expect(messages).toContain(
      'Blood glucose must be in mmol/L (0-60). If your meter shows mg/dL, divide by 18.',
    );
  });

  it('accepts a plausible mmol/L blood glucose reading', async () => {
    const dto = plainToInstance(CreateVitalsDto, { bloodGlucose: 7.2 });
    const messages = await messagesFor(dto);
    expect(messages.some((m) => m.includes('glucose'))).toBe(false);
  });

  it('accepts a decimal weight (paediatric precision)', async () => {
    const dto = plainToInstance(CreateVitalsDto, { weightKg: 3.4 });
    const messages = await messagesFor(dto);
    expect(messages.some((m) => m.toLowerCase().includes('weight'))).toBe(false);
  });
});

describe('UpdatePatientDto height/weight coercion (FUNC-4)', () => {
  it('coerces a string height/weight from the registration wizard into numbers', async () => {
    const dto = plainToInstance(UpdatePatientDto, { heightCm: '172', weightKg: '68.5' });
    expect(dto.heightCm).toBe(172);
    expect(dto.weightKg).toBe(68.5);
    const messages = await messagesFor(dto);
    expect(messages).toHaveLength(0);
  });

  it('still rejects a non-integer height string with the specific message', async () => {
    const dto = plainToInstance(UpdatePatientDto, { heightCm: '172.5' });
    const messages = await messagesFor(dto);
    expect(messages).toContain('Height must be a whole number in cm');
  });

  it('accepts a decimal weight string (paediatric precision, e.g. a 3.4kg newborn)', async () => {
    const dto = plainToInstance(UpdatePatientDto, { weightKg: '3.4' });
    expect(dto.weightKg).toBe(3.4);
    const messages = await messagesFor(dto);
    expect(messages).toHaveLength(0);
  });
});
