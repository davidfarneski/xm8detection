require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');

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
    fileSize: 20 * 1024 * 1024, // 20MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '2.0.0 - TensorFlow.js + GPT-4 Vision' 
  });
});

// Main image analysis endpoint with GPT-4 Vision
app.post('/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to environment variables.' 
      });
    }

    console.log('Analyzing image with GPT-4 Vision:', req.file.originalname, 'Size:', req.file.size);

    // Convert image buffer to base64
    const base64Image = req.file.buffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${base64Image}`;

    // Create detailed prompt for building/contents analysis
    const analysisPrompt = `You are a professional building inspector and contents specialist analyzing this image for insurance and construction purposes.

Please provide a detailed analysis in the following JSON format:

{
  "primaryItem": {
    "name": "specific item name",
    "category": "roofing|exterior|interior|appliances|fixtures|contents",
    "confidence": 85,
    "condition": "new|good|fair|damaged|severely_damaged",
    "material": "specific material type",
    "ageEstimate": "approximate age in years",
    "brandModel": "if visible"
  },
  "detectedItems": [
    {
      "name": "item name", 
      "category": "category",
      "confidence": 90,
      "description": "detailed description"
    }
  ],
  "damageAssessment": {
    "hasDamage": true/false,
    "damageType": "water|fire|wind|impact|wear|none",
    "severity": "minor|moderate|major|total_loss",
    "description": "specific damage description"
  },
  "xactimateNotes": "Professional notes suitable for XACTIMATE coding and insurance estimates",
  "recommendations": ["action item 1", "action item 2"],
  "summary": "Professional summary for insurance/construction use"
}

Focus on:
- Building materials (roofing, siding, flooring, etc.)
- Appliances and fixtures (HVAC, plumbing, electrical)
- Personal contents (furniture, electronics, tools)
- Damage assessment if present
- Professional terminology suitable for insurance claims
- Age and condition assessment
- Brand identification when visible

Be specific and professional - this will be used for insurance estimates and construction planning.`;

    // Call GPT-4 Vision
    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: analysisPrompt
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 1500,
      temperature: 0.1 // Lower temperature for more consistent, professional results
    });

    const gptResponse = response.choices[0].message.content;
    
    // Try to parse JSON response
    let analysis;
    try {
      // Extract JSON from response if it's wrapped in text
      const jsonMatch = gptResponse.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : gptResponse;
      analysis = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      // Fallback - create structured response from text
      analysis = {
        primaryItem: {
          name: "Analysis completed",
          category: "unknown",
          confidence: 75,
          condition: "unknown"
        },
        detectedItems: [],
        damageAssessment: {
          hasDamage: false,
          damageType: "none",
          severity: "none"
        },
        xactimateNotes: gptResponse,
        recommendations: ["Review analysis for accuracy"],
        summary: gptResponse.substring(0, 200) + "..."
      };
    }

    // Add metadata
    const result = {
      success: true,
      analysis: analysis,
      metadata: {
        filename: req.file.originalname,
        fileSize: req.file.size,
        processedAt: new Date().toISOString(),
        model: "gpt-4-vision-preview",
        tokensUsed: response.usage?.total_tokens || 0
      },
      rawResponse: gptResponse // For debugging
    };

    res.json(result);

  } catch (error) {
    console.error('Error analyzing image with GPT-4 Vision:', error);
    
    // Handle specific OpenAI errors
    if (error.status === 401) {
      return res.status(401).json({ 
        error: 'Invalid OpenAI API key. Please check your OPENAI_API_KEY environment variable.' 
      });
    }
    
    if (error.status === 429) {
      return res.status(429).json({ 
        error: 'OpenAI API rate limit exceeded. Please try again in a moment.' 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to analyze image with GPT-4 Vision',
      details: error.message 
    });
  }
});

// XACTIMATE code lookup endpoint (placeholder for future enhancement)
app.get('/xactimate-codes', (req, res) => {
  res.json({
    message: "XACTIMATE code database integration coming soon",
    supportedCategories: [
      "roofing", "exterior", "interior", 
      "appliances", "fixtures", "contents"
    ]
  });
});

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
  console.log(`🚀 XM8Detection v2.0 server running on port ${PORT}`);
  console.log(`📱 Visit: http://localhost:${PORT}`);
  console.log(`🧠 Powered by TensorFlow.js + GPT-4 Vision`);
  console.log(`🏠 Ready for professional building & contents analysis!`);
});
