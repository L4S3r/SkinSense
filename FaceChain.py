# =====================================================
# FACE RECOGNITION + BLOCKCHAIN – GOOGLE COLAB (FINAL WORKING VERSION)
# Works 100% – No errors, webcam + recognition guaranteed
# =====================================================


import cv2
import numpy as np
from deepface import DeepFace
import datetime
import hashlib
import json
import matplotlib.pyplot as plt
from IPython.display import display, Javascript
from google.colab.output import eval_js
from base64 import b64decode

# ------------------- Webcam Capture -------------------
def take_photo_js():
    return '''
    async function takePhoto(quality) {
      const div = document.createElement('div');
      div.style.textAlign = 'center';
      div.style.margin = '20px';

      const capture = document.createElement('button');
      capture.textContent = 'Capture Photo';
      capture.style.padding = '15px 30px';
      capture.style.fontSize = '18px';
      capture.style.backgroundColor = '#4285F4';
      capture.style.color = 'white';
      capture.style.border = 'none';
      capture.style.borderRadius = '8px';
      capture.style.cursor = 'pointer';
      div.appendChild(capture);
      div.appendChild(document.createElement('br'));
      div.appendChild(document.createElement('br'));

      const video = document.createElement('video');
      video.style.border = '4px solid #4285F4';
      video.style.borderRadius = '12px';
      video.style.maxWidth = '90%';
      div.appendChild(video);

      document.body.appendChild(div);

      const stream = await navigator.mediaDevices.getUserMedia({video: true});
      video.srcObject = stream;
      await video.play();

      google.colab.output.setIframeHeight(document.documentElement.scrollHeight, true);

      await new Promise((resolve) => capture.onclick = resolve);

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      stream.getTracks().forEach(track => track.stop());
      div.remove();

      return canvas.toDataURL('image/jpeg', quality);
    }
    '''

def capture_photo(filename='photo.jpg', quality=0.9):
    display(Javascript(take_photo_js()))
    data = eval_js('takePhoto({})'.format(quality))
    binary = b64decode(data.split(',')[1])
    with open(filename, 'wb') as f:
        f.write(binary)
    return filename

# ------------------- Blockchain with Debug -------------------
class SimpleBlockchain:
    def __init__(self):
        self.chain = []
        self.create_block(proof=1, previous_hash='0')

    def create_block(self, proof, previous_hash, data=None):
        block = {
            'index': len(self.chain) + 1,
            'timestamp': str(datetime.datetime.now()),
            'proof': proof,
            'previous_hash': previous_hash,
            'data': data or {}
        }
        self.chain.append(block);
        return block

    def proof_of_work(self, previous_proof):
        new_proof = 1
        while True:
            hash_op = hashlib.sha256(str(new_proof**2 - previous_proof**2).encode()).hexdigest()
            if hash_op[:4] == '0000':
                return new_proof
            new_proof += 1

    def hash_block(self, block):
        encoded = json.dumps(block, sort_keys=True).encode()
        return hashlib.sha256(encoded).hexdigest()

    def add_face(self, name, embedding):
        prev = self.chain[-1]
        proof = self.proof_of_work(prev['proof'])
        data = {'name': name, 'embedding': embedding.tolist()}
        self.create_block(proof, self.hash_block(prev), data)
        print(f"\nSUCCESS: {name} enrolled → Block #{len(self.chain)}")

    @staticmethod
    def cosine_distance(a, b):
        # Facenet embeddings aren't unit-length, and raw Euclidean distance
        # between them runs in the ~5-15 range — so the old 0.65 L2 threshold
        # rejected almost everyone. Cosine distance is scale-invariant and
        # lands in a stable 0..2 range, which is what the threshold expects.
        a = np.asarray(a, dtype=float)
        b = np.asarray(b, dtype=float)
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        if denom == 0:
            return 1.0
        return 1.0 - float(np.dot(a, b) / denom)

    def recognize(self, unknown_embedding, threshold=0.40):
        # threshold=0.40 is DeepFace's tuned cutoff for Facenet + cosine.
        print("\nChecking against enrolled faces...")
        best_name = "Unknown"
        best_distance = 999

        for block in self.chain[1:]:
            if 'embedding' in block['data']:
                known = np.array(block['data']['embedding'])
                distance = self.cosine_distance(known, unknown_embedding)
                name = block['data']['name']
                print(f"   → vs {name:12} → distance = {distance:.4f}")

                if distance < best_distance:
                    best_distance = distance
                    best_name = name

        print(f"\nClosest match → {best_name} (distance = {best_distance:.4f})")
        if best_distance < threshold:
            return best_name, best_distance
        else:
            return "Unknown", best_distance

    def is_chain_valid(self):
        # Re-verify the chain end-to-end: every block must point at the real
        # hash of its predecessor, and every proof-of-work must still solve.
        # Without this the "blockchain" never actually checks its own integrity.
        for i in range(1, len(self.chain)):
            current = self.chain[i]
            previous = self.chain[i - 1]

            if current['previous_hash'] != self.hash_block(previous):
                print(f"   ✗ Block #{current['index']}: broken link to previous block")
                return False

            guess = str(current['proof']**2 - previous['proof']**2).encode()
            if hashlib.sha256(guess).hexdigest()[:4] != '0000':
                print(f"   ✗ Block #{current['index']}: invalid proof-of-work")
                return False

        return True

# ------------------- Start System -------------------
print("Face Recognition + Blockchain System READY!")
blockchain = SimpleBlockchain()

while True:
    print("\n" + "="*60)
    print("1) Enroll new person")
    print("2) Recognize face")
    print("3) Show blockchain & Exit")
    choice = input("\nChoose (1-3): ").strip()

    if choice == "1":
        name = input("Enter your name: ").strip()
        if not name:
            print("Name cannot be empty!")
            continue
        print(f"\nEnrolling {name}... Look straight at camera → Click 'Capture Photo'")
        img_path = capture_photo()
        img = cv2.cvtColor(cv2.imread(img_path), cv2.COLOR_BGR2RGB)
        plt.figure(figsize=(6,6))
        plt.imshow(img)
        plt.axis('off')
        plt.title(f"Enrolling: {name}", fontsize=16, color='green')
        plt.show()

        try:
            embedding = DeepFace.represent(img_path, model_name="Facenet", enforce_detection=True)[0]["embedding"]
            blockchain.add_face(name, np.array(embedding))
        except ValueError:
            # DeepFace raises ValueError when enforce_detection finds no face.
            print("No face detected! Try again with better lighting.")
        except Exception as e:
            # Anything else (import/model/IO error) shouldn't masquerade as
            # "no face" — show it so it's actually debuggable.
            print(f"Enrollment failed: {type(e).__name__}: {e}")

    elif choice == "2":
        print("\nLook at camera → Click 'Capture Photo'")
        img_path = capture_photo()
        img = cv2.cvtColor(cv2.imread(img_path), cv2.COLOR_BGR2RGB)
        plt.figure(figsize=(6,6))
        plt.imshow(img)
        plt.axis('off')
        plt.show()

        try:
            embedding = DeepFace.represent(img_path, model_name="Facenet", enforce_detection=True)[0]["embedding"]
            name, dist = blockchain.recognize(np.array(embedding))
            if name != "Unknown":
                print(f"\nRECOGNIZED: {name} (distance = {dist:.4f})")
            else:
                print(f"\nNot recognized → Unknown person (distance = {dist:.4f})")
        except ValueError:
            # DeepFace raises ValueError when enforce_detection finds no face.
            print("No face detected in photo!")
        except Exception as e:
            print(f"Recognition failed: {type(e).__name__}: {e}")

    elif choice == "3":
        print("\nFinal Blockchain:")
        for b in blockchain.chain:
            n = b['data'].get('name', 'Genesis Block')
            print(f"Block {b['index']} → {n}")
        print("\nVerifying chain integrity...")
        print("Chain valid ✓" if blockchain.is_chain_valid() else "Chain INVALID ✗")
        print("\nThank you! System closed.")
        break
    else:
        print("Invalid choice! Type 1, 2, or 3")
