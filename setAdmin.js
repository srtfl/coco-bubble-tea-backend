const admin = require('firebase-admin');

   const serviceAccount = require('./serviceAccountKey.json');

   admin.initializeApp({
     credential: admin.credential.cert(serviceAccount),
   });

   const email = 'admin@example.com'; // Replace with your admin user's email

   async function setAdminClaim() {
     try {
       const user = await admin.auth().getUserByEmail(email);
       await admin.auth().setCustomUserClaims(user.uid, { admin: true });
       console.log(`Admin claim set for ${email}`);
     } catch (error) {
       console.error('Error setting admin claim:', error);
     }
   }

   setAdminClaim();