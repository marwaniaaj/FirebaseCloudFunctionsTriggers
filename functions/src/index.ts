/** Most used commands */
// npm run firebase:start:import -> Start Emulator with test-data
// npm run build:watch -> Build TypeScript files
// npm run deploy -> Deploy to Firebase

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// Import required event handlers, types, and type for Firestore triggers
import { 
    onDocumentCreated, 
    onDocumentUpdated, 
    Change, 
    QueryDocumentSnapshot 
} from "firebase-functions/v2/firestore";

// Import the required event handlers for Storage triggers
import { 
     onObjectFinalized, onObjectDeleted
} from "firebase-functions/v2/storage";

// Import the required functions for Storage triggers
import { getStorage, getDownloadURL } from "firebase-admin/storage"

// Path to Firebase service account key file
let serviceAccountPath = '../secure/serviceAccountKey.json';

// Initialize Firebase Admin SDK
if (admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath)),
        storageBucket: 'your-storage-bucket-url'
    });
}

// Set true to use getSignedUrl for mediaUrl, set false to use getDownloadURL
// Make sure to adjust the value of useSignedUrl based on your requirements.
const useSignedUrl = false;

/**
 * 1. Authentication Triggers
 */
export const onAuthUserCreate = functions.auth.user().onCreate(async user => {
    const userData: any = {
        "email": user.email,
        "isAuthenticated": true,
    };
    // If user has a display name, then add to user document
    if (user.displayName !== null && user.displayName !== "") {
        userData["name"] = user.displayName
    }
    // If user has a photo URL, then add to user document
    if (user.photoURL !== null && user.photoURL !== "") {
        userData["photoUrl"] = user.photoURL
    }

    const userDocRef = admin.firestore().doc(`users/${user.uid}`);
    return await userDocRef.set(userData, {merge: true});
    // TODO: Send a welcome email
});

export const onAuthUserDelete = functions.auth.user().onDelete(async user => {
    // TODO: Send a farewell email
});

/**
 * 2. Firestore Triggers
 */
export const onUserDocumentCreate = onDocumentCreated("users/{userId}", (event) => {
    return event.data?.ref.update({
        creationDate: event.data.updateTime,
        "isActive": true,
    });
})

export const onUserDocumentUpdate = onDocumentUpdated("users/{userId}", (change) => {
    return updateLastModifiedOnDocumentUpdate(change.data)
})

/**
 * 3. Storage Triggers
 */
export const onFileFinalized = onObjectFinalized(async (event) => {

    // If `event.data` is null, then return null
    if (!event.data) { return null; }

    // If `contentType` is unknown binary data, then return null
    // This is to prevent the function from running on every file upload
    if (event.data.contentType == "application/octet-stream") { return null; }

    const filePath = event.data.name;
    const bucketName = event.data.bucket;

    // Check if file is uploaded to `books/` or `authors/` directory
    if (event.data.name.includes("books/") || event.data.name.includes("authors/")) {
        // Get document collection and document ID
        const docCollection = event.data.name.split("/")[0]; // "books" or "authors"
        const docId = event.data.name.split("/")[1];
        const fileRef = getStorage().bucket(bucketName).file(filePath);
        
        // If `useSignedUrl` is false, then use `getDownloadURL` to get mediaUrl
        if (!useSignedUrl) {

            // If running in emulator, then use publicUrl
            if (process.env.FUNCTIONS_EMULATOR) {
                console.log("Emulator detected. Switching to publicUrl.")
                const publicUrl = fileRef.publicUrl()
                console.log("Public URL: ", publicUrl)
                return await admin.firestore().doc(`${docCollection}/${docId}`).set({ "mediaUrl": publicUrl }, { merge: true });
            }
            // If running in production, then use getDownloadURL
            const mediaUrl = await getDownloadURL(fileRef)
            console.log("Download URL: ", mediaUrl)
            return await admin.firestore().doc(`${docCollection}/${docId}`).set({ "mediaUrl": mediaUrl }, { merge: true });
        }
        // If `useSignedUrl` is true, then use signed URL to get mediaUrl
        try {
            const options: any = {
                version: 'v4', // Use version 4 signing process
                action: 'read', // Specify the action (read, write, delete, etc.)
                expires: Date.now() + 15 * 60 * 1000, // Set expiration to 15 minutes from now
            };
            const [mediaUrl] = await fileRef.getSignedUrl(options)
            console.log("Signed URL: ", mediaUrl)
            return await admin.firestore().doc(`${docCollection}/${docId}`).set({ "mediaUrl": mediaUrl }, { merge: true });
        } catch (error) {
            console.error("Error generating signed URL: ", error);
        }
    }
    return null;
})

export const onFileDeleted = onObjectDeleted(async (event) => {
    // Check if file is deleted from `books/` or `authors/` directory
    if (event.data.name.includes("books/") || event.data.name.includes("authors/")) {
        const docCollection = event.data.name.split("/")[0]; // "books" or "authors"
        const docId = event.data.name.split("/")[1];
        return await admin.firestore().doc(`${docCollection}/${docId}`).set({"mediaUrl": null}, {merge: true})    
    }
    return null;
})

/**
 * Update `lastModifedDate` field whenever the document is updated.
 * @param change the change before and after the update.
 */
function updateLastModifiedOnDocumentUpdate(change: Change<QueryDocumentSnapshot> | undefined): any {
    if (!change) {
        return null;
    }
    // If `lastModifedDate` field exists
    if (change.before.data().lastModifedDate) {

        // If an update occurred but not triggered by `lastModifedDate` field, then update value
        if (change.before.data().lastModifedDate.isEqual(change.after.data().lastModifedDate)) {
            return change.after.ref.update({
                lastModifedDate: change.after.updateTime,
            });
        }
    } else {
        // If `lastModifedDate` field does not exist, then create field
        return change.after.ref.update({
            lastModifedDate: change.after.updateTime,
        });
    }
};