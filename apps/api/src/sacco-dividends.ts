import { ApiError, object } from './backend.js';
import type { FineractValue } from './fineract.js';

/** Native 1.12 reads allocations by dividend ID and ignores the URL's product.
 * Verify the parent explicitly before returning any allocation page. */
export async function saccoDividendRecord(
  get: (path: string) => Promise<FineractValue>,
  product: string,
  dividend: string,
  offset = '0',
): Promise<FineractValue> {
  if (
    !/^[1-9]\d{0,18}$/.test(product) ||
    !/^[1-9]\d{0,18}$/.test(dividend) ||
    !/^(0|[1-9]\d{0,6})$/.test(offset)
  )
    throw new ApiError(400, 'INVALID_SACCO_REFERENCE');
  // Bounded parent lookup. Monthly payouts would take over 83 years to reach
  // this bound; never assert absence from an incomplete parent result.
  const parent = object(
    await get(`shareproduct/${product}/dividend?limit=1000&offset=0`),
  );
  const rows = parent['pageItems'];
  const total = parent['totalFilteredRecords'];
  if (
    !Array.isArray(rows) ||
    typeof total !== 'string' ||
    !/^\d+$/.test(total) ||
    BigInt(total) < BigInt(rows.length) ||
    rows.length > 1000
  )
    throw new ApiError(502, 'INVALID_FINERACT_RESPONSE');
  if (!rows.some((row) => object(row)['id'] === dividend)) {
    if (BigInt(total) > BigInt(rows.length))
      throw new ApiError(413, 'SACCO_DIVIDEND_LOOKUP_LIMIT');
    throw new ApiError(404, 'SACCO_DIVIDEND_NOT_AVAILABLE');
  }
  return get(
    `shareproduct/${product}/dividend/${dividend}?limit=50&offset=${offset}`,
  );
}
