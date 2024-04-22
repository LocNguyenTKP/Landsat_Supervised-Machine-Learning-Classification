// Define the AOI: Can Tho
var canThoLandCover = ee.FeatureCollection('users/nguyenloctkp/boundary');

// Visualize the AOI boundary for reference
//Map.addLayer(canThoLandCover, {color: 'yellow'}, 'AOI');

var startDate = '2013-01-01';
var endDate = '2013-12-30';

// Import Landsat 8 ImageCollection, filtered by date and bounds
var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterDate(startDate, endDate)
  .filterBounds(canThoLandCover);

// Map a function over the ImageCollection to extract the acquisition date of each image
var imageDates = l8.map(function(image) {
  return ee.Feature(null, {date: image.date().format('YYYY-MM-dd')});
});

// Flatten the collection of features into a list of dates
var listOfDates = imageDates.aggregate_array('date');

// Print the list of dates
listOfDates.getInfo(function(date) {
  print('Acquisition dates of the images:', date);
});


// Function to mask clouds using the QA_PIXEL band of Landsat 8 Collection 2
function maskL8C2(image) {
  var qaPixel = image.select('QA_PIXEL');
  // Check the Landsat Collection 2 QA band bit flags documentation to determine the exact bits for cloud mask
  // Mask out cloud and shadow pixels (these bit numbers are just examples)
  var mask = qaPixel.bitwiseAnd(1 << 3).eq(0) // Cloud shadow
                .and(qaPixel.bitwiseAnd(1 << 5).eq(0)); // Cloud
  return image.updateMask(mask);
}

// Apply the cloud mask function to each image in the collection and create a median composite
var medianComposite = l8.map(maskL8C2).median();

// Clip the median composite image to the Can Tho boundary
var clippedComposite = medianComposite.clip(canThoLandCover);

// Reproject the image to its native resolution
var reprojectedComposite = clippedComposite.reproject({
  crs: clippedComposite.select('SR_B2').projection(),
  scale: 30 // Landsat has a native resolution of 30 meters for its multispectral bands
});

// Visualization parameters
var visParams = {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min: 0, max: 40000, gamma: 1.4};

 
// Visualize the clipped Composite
Map.addLayer(medianComposite , visParams, 'Clipped L8 Image');

// Visualize the clipped Composite
Map.addLayer(clippedComposite, visParams, 'Clipped L8 Image');

// Center the map on the AOI with an appropriate zoom level
Map.centerObject(canThoLandCover, 10);

print(l8.size(), 'Number of images in collection');

// Function to calculate and add NDVI
function addNDVI(image) {
  var ndvi = image.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
  return image.addBands(ndvi);
}

// Apply NDVI function to the median composite
var withNDVI = addNDVI(clippedComposite);

// Function to calculate and add NDWI
function addNDWI(image) {
  var ndwi = image.normalizedDifference(['SR_B3', 'SR_B5']).rename('NDWI');
  return image.addBands(ndwi);
}

// Apply NDWI function to the median composite
var withNDWI = addNDWI(withNDVI);
// Function to calculate and add NDBI
function addNDBI(image) { 
  var ndbi = image.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI');
  return image.addBands(ndbi);
}

// Apply NDBI function to the image with NDVI and NDWI
var finalComposite = addNDBI(withNDWI);
// Visualization parameters for NDVI
var ndviParams = {min: -1, max: 1, palette: ['0000FF', 'FFFFFF', '00FF00']};

// Visualization parameters for NDWI
var ndwiParams = {min: -1, max: 1, palette: ['white', 'blue']};

// Visualization parameters for NDBI
var ndbiParams = {min: -1, max: 1, palette: ['00FF00', 'FFFFFF', 'FF0000']};

// Add the indices as layers
Map.addLayer(finalComposite.select('NDVI'), ndviParams, 'NDVI');
Map.addLayer(finalComposite.select('NDWI'), ndwiParams, 'NDWI');
Map.addLayer(finalComposite.select('NDBI'), ndbiParams, 'NDBI');



// Center the map on the AOI with an appropriate zoom level
Map.centerObject(canThoLandCover, 10);

// Collect Training Data
var urban = ee.FeatureCollection(builtup);
var water = ee.FeatureCollection(water);
var rice = ee.FeatureCollection(rice);
var croplands = ee.FeatureCollection(croplands);

// Ensuring all features in one collection have the 'landcover' property
var urbanWithProperty =urban.map(function(feature) {
  return feature.set('landcover', 1); // Assuming '1' is the class for urban
});

var waterWithProperty = water.map(function(feature) {
  return feature.set('landcover', 2); // Assuming '2' is the class for water
});

var riceWithProperty = rice.map(function(feature) {
  return feature.set('landcover', 3); // Assuming '3' is the class for rice fields
});

var croplandsWithProperty = croplands.map(function(feature) {
  return feature.set('landcover', 4); // Assuming '4' is the class for other crop lands
});


// Merge the prepared feature collections
var newfc = urbanWithProperty.merge(waterWithProperty).merge(riceWithProperty).merge(croplandsWithProperty);
print(newfc, 'landcover');

// Proceed with sampling, classifier training, and classification as before


// Select the bands for training with the 'SR_' prefix
var bands = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'];

// Add a random column to the merged feature collection
var withRandom = newfc.randomColumn('random');

// Split the collection into training and testing sets
var trainingFraction = 0.7; // 70% for training
var trainingSet = withRandom.filter(ee.Filter.lt('random', trainingFraction));
var testingSet = withRandom.filter(ee.Filter.gte('random', trainingFraction));

// Sample the input imagery for training data
var training = clippedComposite.select(bands).sampleRegions({
  collection: trainingSet,
  properties: ['landcover'],
  scale: 30
});

// Sample the input imagery for testing data
var testing = clippedComposite.select(bands).sampleRegions({
  collection: testingSet,
  properties: ['landcover'],
  scale: 30
});


// RANDOM FOREST CLASSIFICATION
// Train the classifier
var classifier = ee.Classifier.smileRandomForest(50).train({
  features: training,
  classProperty: 'landcover',
  inputProperties: bands
});

// Classify the testing set
var testingClassified = testing.classify(classifier);

// Calculate confusion matrix and overall accuracy
var confusionMatrix = testingClassified.errorMatrix('landcover', 'classification');
print('Random Forest Confusion Matrix', confusionMatrix);
print('Random Forest Overall Accuracy', confusionMatrix.accuracy());

// Add calculation for Kappa accuracy
var kappa = confusionMatrix.kappa();
print('Random Forest Kappa Accuracy', kappa);

// Classify the input imagery.
var classified = clippedComposite.select(bands).classify(classifier);

// Clip the classified image to the Can Tho boundary
var classifiedClipped = classified.clip(CT);

// Define a palette for the Land Use classification.

var palette = [
  'FF0000', // Urban (1) - Red
  '0000FF', // Water (2) - Blue
  '70f43f',  // Rice Paddy Fields (3) - Yellow
  '008000', // Other Crop Lands (4)
];


// Display the classification result
Map.addLayer(classifiedClipped, {min: 1, max: 4, palette: palette}, 'Land Use Classification');


// Ensure pixelAreaImage is defined correctly
var pixelAreaImage = ee.Image.pixelArea();

// Mask the pixelAreaImage by each class in 'classified' and sum the areas
var urbanArea = pixelAreaImage.updateMask(classified.eq(1)).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: canThoLandCover.geometry(),
  scale: 30,
  maxPixels: 1e9
}).get('area');

var waterArea = pixelAreaImage.updateMask(classified.eq(2)).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: canThoLandCover.geometry(),
  scale: 30,
  maxPixels: 1e9
}).get('area');

var riceArea = pixelAreaImage.updateMask(classified.eq(3)).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: canThoLandCover.geometry(),
  scale: 30,
  maxPixels: 1e9
}).get('area');

var croplandsArea = pixelAreaImage.updateMask(classified.eq(4)).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: canThoLandCover.geometry(),
  scale: 30,
  maxPixels: 1e9
}).get('area');


// Assuming 'urbanArea', 'waterArea', and 'vegetationArea' are already defined from previous steps
// Convert them from Earth Engine objects to numbers
var totalAreaSum = ee.Number(urbanArea).add(ee.Number(waterArea)).add(ee.Number(riceArea)).add(ee.Number(croplandsArea));

var urbanPercentage = ee.Number(urbanArea).divide(totalAreaSum).multiply(100);
var waterPercentage = ee.Number(waterArea).divide(totalAreaSum).multiply(100);
var ricePercentage = ee.Number(riceArea).divide(totalAreaSum).multiply(100);
var croplandsPercentage = ee.Number(croplandsArea).divide(totalAreaSum).multiply(100);

// Print the percentages
urbanPercentage.evaluate(function(urbanPerc) {
  print('Random Forest Urban area percentage:', urbanPerc.toFixed(2));
});
waterPercentage.evaluate(function(waterPerc) {
  print('Random Forest Water area percentage:', waterPerc.toFixed(2));
});
ricePercentage.evaluate(function(ricePerc) {
  print('Random Forest Rice paddy area percentage:', ricePerc.toFixed(2));
});
croplandsPercentage.evaluate(function(cropPerc) {
  print('Random Forest Other crop lands area percentage:', cropPerc.toFixed(2));
});

// Export the NDVI map to Google Drive
Export.image.toDrive({
  image: withNDVI.select('NDVI'), // Selecting the NDVI band from the image with added NDVI
  description: 'NDVI_Map_2023', // A description for the exported file
  folder: 'GEE_Exports_NEW', // The Google Drive folder to export to (optional)
  fileNamePrefix: 'NDVI_Map_2023', // A prefix for the file name (optional)
  region: canThoLandCover.geometry(), // The region to export
  scale: 30, // The scale in meters, matching Landsat resolution
  maxPixels: 1e9, // Maximum number of pixels to export
  fileFormat: 'GeoTIFF', // The file format
  formatOptions: {
    cloudOptimized: true // Option for creating a cloud-optimized GeoTIFF
  }
});


// Export the classified image to Google Drive
Export.image.toDrive({
  image: classifiedClipped, // The image to export
  description: 'RF_LandUse_Classification_2023', // A description for the exported file
  folder: 'GEE_Exports_NEW', // The Google Drive folder to export to (optional)
  fileNamePrefix: 'RF_LandUse_Classification_2023', // A prefix for the file name (optional)
  region: canThoLandCover.geometry(), // The region to export
  scale: 30, // The scale in meters (Landsat resolution is 30 meters)
  maxPixels: 1e9, // Maximum number of pixels to export
  fileFormat: 'GeoTIFF', // The file format (GeoTIFF is common for GIS data)
  formatOptions: {
    cloudOptimized: true // Option for creating a cloud-optimized GeoTIFF
  }
});

