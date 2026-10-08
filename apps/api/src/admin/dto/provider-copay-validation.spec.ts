import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InsuranceProviderDto, UpdateInsuranceProviderDto } from './admin.dto';

async function messagesFor(dto: object) {
  const errors = await validate(dto as any);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

/** Fix 3 of the "HMO claims not reflecting" investigation (2026-10-08,
 * docs/audit/phase1-status.md): defaultCoPayPct had no DTO validation at
 * all - it didn't exist as a field. 0-100, decimals allowed. */
describe('InsuranceProviderDto / UpdateInsuranceProviderDto - defaultCoPayPct validation', () => {
  const base = { name: 'Validation HMO', kind: 'HMO' };

  it('accepts a plain integer co-pay', async () => {
    const dto = plainToInstance(InsuranceProviderDto, { ...base, defaultCoPayPct: 10 });
    expect(await messagesFor(dto)).toHaveLength(0);
  });

  it('accepts a decimal co-pay with up to 2 places', async () => {
    const dto = plainToInstance(InsuranceProviderDto, { ...base, defaultCoPayPct: 12.5 });
    expect(await messagesFor(dto)).toHaveLength(0);
  });

  it('accepts 0 and 100 as the inclusive bounds', async () => {
    expect(await messagesFor(plainToInstance(InsuranceProviderDto, { ...base, defaultCoPayPct: 0 }))).toHaveLength(0);
    expect(await messagesFor(plainToInstance(InsuranceProviderDto, { ...base, defaultCoPayPct: 100 }))).toHaveLength(0);
  });

  it('rejects a negative co-pay', async () => {
    const dto = plainToInstance(InsuranceProviderDto, { ...base, defaultCoPayPct: -1 });
    expect((await messagesFor(dto)).length).toBeGreaterThan(0);
  });

  it('rejects a co-pay over 100', async () => {
    const dto = plainToInstance(InsuranceProviderDto, { ...base, defaultCoPayPct: 101 });
    expect((await messagesFor(dto)).length).toBeGreaterThan(0);
  });

  it('rejects more than 2 decimal places', async () => {
    const dto = plainToInstance(InsuranceProviderDto, { ...base, defaultCoPayPct: 12.345 });
    expect((await messagesFor(dto)).length).toBeGreaterThan(0);
  });

  it('is optional - omitting it is valid (left unconfigured, never guessed)', async () => {
    const dto = plainToInstance(InsuranceProviderDto, { ...base });
    expect(await messagesFor(dto)).toHaveLength(0);
  });

  it('the update DTO validates the same way', async () => {
    const bad = plainToInstance(UpdateInsuranceProviderDto, { defaultCoPayPct: 150 });
    expect((await messagesFor(bad)).length).toBeGreaterThan(0);
    const good = plainToInstance(UpdateInsuranceProviderDto, { defaultCoPayPct: 50 });
    expect(await messagesFor(good)).toHaveLength(0);
  });
});
