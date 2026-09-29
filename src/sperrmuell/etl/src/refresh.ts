import { refreshSchedules, windowYears } from "./schedules.js";

/**
 * `npm run schedules`: fetch this year's and next year's schedule into
 * etl/termine/. Whether anything changed is for git to say; the weekly
 * workflow rebuilds the data only if it did.
 */
const years = windowYears(new Date());
const result = await refreshSchedules(years);
for (const { year, status } of result) console.log(`[csv] ${year}: ${status}`);
