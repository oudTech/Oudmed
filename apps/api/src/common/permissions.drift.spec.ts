import { readFileSync } from 'fs';
import { join } from 'path';
import { MATRIX as apiMatrix } from './permissions';

/**
 * The web app carries a hand-kept copy of the permission MATRIX
 * (apps/web/lib/permissions.ts) for hiding/disabling UI. This test fails the
 * build if the two ever diverge - add an action to one, you must add it to both.
 */
describe('permission MATRIX drift (api vs web mirror)', () => {
  it('the web mirror matches the API matrix exactly', () => {
    const webSrc = readFileSync(
      join(__dirname, '../../../web/lib/permissions.ts'),
      'utf8',
    );
    const objText = webSrc.match(/export const MATRIX[^=]*=\s*({[\s\S]*?\n})/)?.[1];
    if (!objText) throw new Error('Could not locate MATRIX in apps/web/lib/permissions.ts');

    // The literal is plain data (string keys, string[] values) - safe to evaluate.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const webMatrix: Record<string, string[]> = new Function(`return (${objText})`)();

    const norm = (m: Record<string, string[]>) =>
      Object.fromEntries(
        Object.entries(m).map(([k, v]) => [k, [...v].sort()]),
      );

    expect(norm(webMatrix)).toEqual(norm(apiMatrix as Record<string, string[]>));
  });
});
