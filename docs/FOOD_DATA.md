# Food search data

Source: U.S. Department of Agriculture, Agricultural Research Service, FoodData Central.
Official download: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip
Dataset: SR Legacy, April 2018 (historical reference data, not live brand labels).
Retrieved: 2026-10-22. ZIP SHA-256: 0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef.
License: public domain / CC0 1.0, https://fdc.nal.usda.gov/api-guide/ .

Only records with all four finite nonnegative values are included: nutrient 1008 (kcal), 1003 (protein g), 1005 (carbohydrate g), 1004 (fat g). All are per 100 grams edible portion. No calories are inferred from macronutrients. 7,793 records qualify. Names for 29 common records are translated; English descriptions and FDC IDs are preserved. Other foods can be found in English; a limited Chinese synonym map expands common searches. This is not a comprehensive Chinese dishes database.

The calculator multiplies each reference value by edible grams / 100 and rounds to two decimal places. Raw/cooked states are separate foods. Oil, sauces and mixed dishes are not inferred. Records keep a source snapshot so later database updates cannot silently alter saved meals. No request or API key is required for food search. AI photo recognition is not part of this feature.

Rebuild: download the archive above, then run `python3 scripts/fitpilot/build-foods.py /path/to/archive.zip` from the repository root. The generator verifies the archive checksum.
