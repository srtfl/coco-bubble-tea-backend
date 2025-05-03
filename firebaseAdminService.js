// firebaseAdminService.js
const admin = require('firebase-admin');

// Load Firebase credentials
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  try {
    serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    console.log('✅ Loaded Firebase credentials from FIREBASE_SERVICE_ACCOUNT_BASE64');
  } catch (err) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:', err);
    process.exit(1);
  }
} else {
  try {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('✅ Loaded Firebase credentials from serviceAccountKey.json');
  } catch (err) {
    console.error('❌ Failed to load serviceAccountKey.json:', err);
    console.error('Please ensure serviceAccountKey.json exists for local development.');
    process.exit(1);
  }
}

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Fetch all products
const getProducts = async () => {
  const querySnapshot = await db.collection('products').get();
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// Delete a product by ID
const deleteProduct = async (productId) => {
  await db.collection('products').doc(productId).delete();
};

// Fetch all promotions
const getPromotions = async () => {
  const querySnapshot = await db.collection('promotions').get();
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// Delete a promotion by ID
const deletePromotion = async (promotionId) => {
  await db.collection('promotions').doc(promotionId).delete();
};

// Fetch all categories
const getCategories = async () => {
  const querySnapshot = await db.collection('categories').get();
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

module.exports = {
  getProducts,
  deleteProduct,
  getPromotions,
  deletePromotion,
  getCategories,
};