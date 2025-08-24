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
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
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

// Main image analysis endpoint
app.post('/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    console.log('Analyzing image:', req.file.originalname, 'Size:', req.file.size);

    // Analyze image with Google Vision API
    const [result] = await visionClient.labelDetection({
      image: { content: req.file.buffer }
    });

    // Also get object localization for more detailed results
    const [objectResult] = await visionClient.objectLocalization({
      image: { content: req.file.buffer }
    });

    // Process and categorize results
    const labels = result.labelAnnotations || [];
    const objects = objectResult.localizedObjectAnnotations || [];

    // Filter for roofing-related terms
    const roofingKeywords = [
      'roof', 'roofing', 'shingle', 'tile', 'metal', 'slate', 
      'asphalt', 'cedar', 'wood', 'concrete', 'clay', 'membrane',
      'building', 'house', 'structure', 'architecture', 'construction',
      'gutter', 'chimney', 'vent', 'flashing', 'ridge'
    ];

    const categorizedResults = {
      roofingMaterials: [],
      buildingElements: [],
      generalLabels: [],
      objects: []
    };

    // Categorize labels
    labels.forEach(label => {
      const isRoofingRelated = roofingKeywords.some(keyword => 
        label.description.toLowerCase().includes(keyword.toLowerCase())
      );

      const labelData = {
        description: label.description,
        confidence: Math.round(label.score * 100),
        score: label.score
      };

      if (isRoofingRelated) {
        if (['roof', 'roofing', 'shingle', 'tile', 'metal', 'slate', 'asphalt'].some(term => 
            label.description.toLowerCase().includes(term))) {
          categorizedResults.roofingMaterials.push(labelData);
        } else {
          categorizedResults.buildingElements.push(labelData);
        }
      } else if (label.score > 0.7) {
        categorizedResults.generalLabels.push(labelData);
      }
    });

    // Process objects
    objects.forEach(obj => {
      categorizedResults.objects.push({
        name: obj.name,
        confidence: Math.round(obj.score * 100),
        score: obj.score
      });
    });

    // Generate analysis summary
    const summary = generateAnalysisSummary(categorizedResults);

    res.json({
      success: true,
      analysis: categorizedResults,
      summary: summary,
      metadata: {
        filename: req.file.originalname,
        fileSize: req.file.size,
        processedAt: new Date().toISOString()
      }
    });

  } catch (error) {
  console.error('Error analyzing image:', error);
  console.error('Error details:', JSON.stringify(error, null, 2));
  console.error('Error message:', error.message);
  console.error('Error code:', error.code);
  console.error('Error status:', error.status);
  
  res.status(500).json({ 
    error: 'Failed to analyze image',
    details: error.message,
    code: error.code,
    status: error.status
  });
    });
  }
});

// Helper function to generate analysis summary
function generateAnalysisSummary(results) {
  let summary = {
    detectedMaterials: [],
    confidence: 'low',
    recommendations: []
  };

  const materials = results.roofingMaterials;
  
  if (materials.length === 0) {
    summary.recommendations.push('No specific roofing materials detected. Try uploading a clearer image of the roof surface.');
    return summary;
  }

  // Extract likely materials
  materials.forEach(material => {
    if (material.confidence > 70) {
      summary.detectedMaterials.push({
        material: material.description,
        confidence: material.confidence
      });
    }
  });

  // Determine overall confidence
  const avgConfidence = materials.reduce((sum, m) => sum + m.confidence, 0) / materials.length;
  if (avgConfidence > 80) summary.confidence = 'high';
  else if (avgConfidence > 60) summary.confidence = 'medium';
  else summary.confidence = 'low';

  // Generate recommendations
  if (summary.detectedMaterials.length > 0) {
    summary.recommendations.push('Materials successfully identified. Ready for XACTIMATE code mapping.');
  } else {
    summary.recommendations.push('Low confidence detection. Consider retaking photo with better lighting or closer view.');
  }

  return summary;
}

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`XM8Detection server running on port ${PORT}`);
  console.log(`Visit: http://localhost:${PORT}`);
});
