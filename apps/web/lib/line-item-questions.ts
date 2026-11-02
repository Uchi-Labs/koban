// Turning a question about a product ("how much did I spend on oat milk this year?") into a
// line-item query: the words that name the product, and the date range the question gives.

export interface LineItemQuestion {
  from?: string;
  /** How the range reads back in an answer ("this year"), when the question gave one. */
  period?: string;
  query: string;
  to?: string;
}

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthShort = months.map((month) => month.slice(0, 3));

// Words that ask the question rather than name the thing bought.
const questionWords = new Set(
  (
    "a about across all am an and any are as at be been buy buying bought by can cost costed costing costs did do does done each " +
    "every far for from get getting got had has have how i i've in into is it its last many me money month months much my of on " +
    "or order ordered orders our paid pay paying purchase purchased purchases receipt receipts show since so spend spending spent " +
    "that the this those through times to total totals tell us was we week weeks were what when where which who year years you " +
    "your ytd today yesterday item items line lines go goes going went gone come came need needed use used just ever often average past twelve during over 12"
  ).split(" ")
);

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The product phrase and date range of an item question, or undefined when no product words are
 * left once the question words are removed. `now` is injectable for tests.
 */
export function lineItemQuestion(question: string, now = new Date()): LineItemQuestion | undefined {
  const lower = question.toLowerCase();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let range: Pick<LineItemQuestion, "from" | "period" | "to"> = {};

  if (/\bthis year\b|\bytd\b|\byear to date\b|\b(in|for|during|over) the year\b/.test(lower)) {
    range = { from: `${year}-01-01`, period: "this year", to: isoDay(now) };
  } else if (/\b(past|last) (12|twelve) months\b|\bpast year\b/.test(lower)) {
    range = { from: isoDay(new Date(Date.UTC(year - 1, month, now.getUTCDate() + 1))), period: "over the past year", to: isoDay(now) };
  } else if (/\blast year\b/.test(lower)) {
    range = { from: `${year - 1}-01-01`, period: "last year", to: `${year - 1}-12-31` };
  } else if (/\bthis month\b/.test(lower)) {
    range = { from: isoDay(new Date(Date.UTC(year, month, 1))), period: "this month", to: isoDay(now) };
  } else if (/\blast month\b/.test(lower)) {
    range = { from: isoDay(new Date(Date.UTC(year, month - 1, 1))), period: "last month", to: isoDay(new Date(Date.UTC(year, month, 0))) };
  } else {
    const named = months.findIndex((name, index) => new RegExp(`\\b(${name}|${monthShort[index]})\\b`).test(lower));
    if (named >= 0) {
      // a month later than this one means last year's
      const y = named > month ? year - 1 : year;
      range = { from: isoDay(new Date(Date.UTC(y, named, 1))), period: `in ${months[named][0].toUpperCase()}${months[named].slice(1)}`, to: isoDay(new Date(Date.UTC(y, named + 1, 0))) };
    }
  }

  const words = lower
    .replace(/[^a-z0-9'&\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !questionWords.has(word) && !months.includes(word) && !monthShort.includes(word) && !/^\d{4}$/.test(word));

  return words.length > 0 && words.length <= 5 ? { ...range, query: words.join(" ") } : undefined;
}
