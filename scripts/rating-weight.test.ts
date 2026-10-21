import assert from "node:assert/strict";
import { ratingWeight, UNRATED_WEIGHT } from "../src/services.js";

// Mike's rule: an unrated meal is weighted exactly like a 2.5-star meal.
// Ratings are quarter units, so 2.5 stars = 10, greater than 1 star = 4.
assert.equal(UNRATED_WEIGHT, 10);
assert.equal(ratingWeight({ mikes_rating: null, michelles_rating: null }), 10);
assert.equal(ratingWeight({ mikes_rating: 4, michelles_rating: null }), 4);
assert.ok(
  ratingWeight({ mikes_rating: null, michelles_rating: null }) >
    ratingWeight({ mikes_rating: 4, michelles_rating: 4 }),
  "an unrated meal must outweigh a meal rated 1 star by both people",
);
assert.equal(ratingWeight({ mikes_rating: 20, michelles_rating: 12 }), 16);

console.log("PASS  ratingWeight: unrated = 10 (2.5 stars), rated = entered average");
