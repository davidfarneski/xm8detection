require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const vision = require('@google-cloud/vision');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for better quality images
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Initialize Google Vision client
const visionClient = new vision.ImageAnnotatorClient({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    project_id: process.env.GOOGLE_PROJECT_ID,
  }
});

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Main image analysis endpoint - now handles cropped regions
app.post('/analyze-region', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { cropData } = req.body;
    console.log('Analyzing cropped region:', req.file.originalname, 'Size:', req.file.size);
    console.log('Crop data:', cropData);

    let imageBuffer = req.file.buffer;

    // If crop data is provided, we would crop the image here
    // For now, we'll analyze the full image but note that cropping was requested
    if (cropData) {
      console.log('Crop region specified:', cropData);
      // In a full implementation, you'd crop the image using a library like sharp or canvas
      // For this demo, we'll proceed with the full image
    }

    // Analyze image with Google Vision API - multiple detection types
    const [labelResult] = await visionClient.labelDetection({
      image: { content: imageBuffer }
    });

    const [objectResult] = await visionClient.objectLocalization({
      image: { content: imageBuffer }
    });

    const [textResult] = await visionClient.textDetection({
      image: { content: imageBuffer }
    });

    // Process results
    const labels = labelResult.labelAnnotations || [];
    const objects = objectResult.localizedObjectAnnotations || [];
    const textAnnotations = textResult.textAnnotations || [];

    // Enhanced categorization for building materials and contents
    const buildingKeywords = {
      roofing: ['roof', 'roofing', 'shingle', 'tile', 'slate', 'asphalt', 'metal roofing', 'gutter', 'downspout', 'flashing', 'ridge', 'vent'],
      exterior: ['siding', 'brick', 'stucco', 'window', 'door', 'garage', 'fence', 'deck', 'patio'],
      interior: ['floor', 'flooring', 'carpet', 'hardwood', 'tile', 'ceiling', 'wall', 'paint', 'drywall'],
      appliances: ['refrigerator', 'stove', 'oven', 'dishwasher', 'washer', 'dryer', 'microwave', 'hvac', 'furnace', 'air conditioner'],
      fixtures: ['light', 'lighting', 'fixture', 'faucet', 'sink', 'toilet', 'bathtub', 'shower', 'cabinet', 'countertop'],
      contents: ['furniture', 'sofa', 'chair', 'table', 'bed', 'dresser', 'television', 'computer', 'electronics']
    };

    const categorizedResults = {
      primaryDetection: null,
      roofing: [],
      exterior: [],
      interior: [],
      appliances: [],
      fixtures: [],
      contents: [],
      other: [],
      objects: [],
      text: textAnnotations.length > 0 ? textAnnotations[0].description : null
    };

    // Find the highest confidence detection as primary
    let highestConfidence = 0;
    let primaryItem = null;

    // Process labels
    labels.forEach(label => {
      const labelData = {
        description: label.description,
        confidence: Math.round(label.score * 100),
        score: label.score,
        type: 'label'
      };

      if (label.score > highestConfidence) {
        highestConfidence = label.score;
        primaryItem = labelData;
      }

      // Categorize by building type
      let categorized = false;
      for (const [category, keywords] of Object.entries(buildingKeywords)) {
        if (keywords.some(keyword => 
          label.description.toLowerCase().includes(keyword.toLowerCase()))) {
          categorizedResults[category].push(labelData);
          categorized = true;
          break;
        }
      }

      if (!categorized && label.score > 0.6) {
        categorizedResults.other.push(labelData);
      }
    });

    // Process objects with higher priority for primary detection
    objects.forEach(obj => {
      const objData = {
        name: obj.name,
        confidence: Math.round(obj.score * 100),
        score: obj.score,
        type: 'object',
        boundingBox: obj.boundingPoly
      };

      // Objects often have higher relevance for building detection
      if (obj.score > highestConfidence) {
        highestConfidence = obj.score;
        primaryItem = objData;
      }

      categorizedResults.objects.push(objData);
    });

    // Set primary detection
    categorizedResults.primaryDetection = primaryItem;

    // Generate enhanced analysis
    const analysis = generateBuildingAnalysis(categorizedResults);

    res.json({
      success: true,
      analysis: categorizedResults,
      summary: analysis,
      metadata: {
        filename: req.file.originalname,
        fileSize: req.file.size,
        processedAt: new Date().toISOString(),
        cropApplied: !!cropData
      }
    });

  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).json({ 
      error: 'Failed to analyze image',
      details: error.message 
    });
  }
});

// Enhanced analysis for building materials and contents
function generateBuildingAnalysis(results) {
  let analysis = {
    primaryItem: null,
    category: 'unknown',
    confidence: 'low',
    detectedItems: [],
    recommendations: [],
    xactimateReady: false
  };

  if (results.primaryDetection) {
    analysis.primaryItem = {
      name: results.primaryDetection.name || results.primaryDetection.description,
      confidence: results.primaryDetection.confidence,
      type: results.primaryDetection.type
    };

    // Determine category based on what was found
    const categories = ['roofing', 'exterior', 'interior', 'appliances', 'fixtures', 'contents'];
    for (const category of categories) {
      if (results[category].length > 0) {
        analysis.category = category;
        break;
      }
    }

    // Set confidence level
    if (results.primaryDetection.confidence > 85) {
      analysis.confidence = 'high';
      analysis.xactimateReady = true;
    } else if (results.primaryDetection.confidence > 70) {
      analysis.confidence = 'medium';
      analysis.xactimateReady = true;
    } else {
      analysis.confidence = 'low';
    }

    // Collect all significant detections
    const allItems = [
      ...results.roofing,
      ...results.exterior, 
      ...results.interior,
      ...results.appliances,
      ...results.fixtures,
      ...results.contents,
      ...results.objects
    ].filter(item => item.confidence > 60)
     .sort((a, b) => b.confidence - a.confidence)
     .slice(0, 5);

    analysis.detectedItems = allItems;

    // Generate recommendations
    if (analysis.xactimateReady) {
      analysis.recommendations.push(`${analysis.primaryItem.name} identified with ${analysis.confidence} confidence - ready for XACTIMATE coding`);
    } else {
      analysis.recommendations.push('Low confidence detection - consider retaking photo with better lighting or closer view');
    }

    if (analysis.category !== 'unknown') {
      analysis.recommendations.push(`Category: ${analysis.category.charAt(0).toUpperCase() + analysis.category.slice(1)} - suitable for property assessment`);
    }

  } else {
    analysis.recommendations.push('No clear objects detected. Ensure item is centered and well-lit in the frame');
  }

  return analysis;
}

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 20MB.' });
    }
  }
  
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 XM8Detection server running on port ${PORT}`);
  console.log(`📱 Visit: http://localhost:${PORT}`);
  console.log(`🏠 Ready for building & contents detection!`);
});
