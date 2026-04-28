import cv2
import numpy as np
import os
from sklearn.metrics.pairwise import euclidean_distances
import matplotlib.pyplot as plt


# 1. Dynamisk sökväg: Hitta mappen där detta skript (.py filen) ligger
script_dir = os.path.dirname(os.path.abspath(__file__))
image_folder = os.path.join(script_dir, 'images')

# Skapar listan med filnamn 01.jpg till 12.jpg 
image_files = [f"{i:02d}.jpg" for i in range(1, 13)]

def extract_features(image_path):
    img = cv2.imread(image_path)
    if img is None:
        print(f"Kunde inte ladda: {image_path}") # Debug-utskrift
        return None
    
    hsv_img = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # Histogram som feature vector [cite: 13, 14]
    hist = cv2.calcHist([hsv_img], [0, 1, 2], None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    return hist.flatten()

# 2. Extrahera features
features_list = []
valid_images = []

for filename in image_files:
    path = os.path.join(image_folder, filename)
    features = extract_features(path)
    if features is not None:
        features_list.append(features)
        valid_images.append(filename)

# KONTROLL: Krascha inte om inga bilder hittades
if len(features_list) == 0:
    print(f"\nFEL: Inga bilder hittades i mappen: {image_folder}")
    print("Se till att bilderna ligger i en undermapp som heter 'images' där ditt skript finns.")
else:
    # 3. Beräkna matrisen om vi har data [cite: 20]
    features_matrix = np.array(features_list)
    dist_matrix = euclidean_distances(features_matrix, features_matrix)
    
    print(f"Lyckades ladda {len(valid_images)} bilder!")
    # ... fortsätt med rankning nedanför

    # Printa matrisen med lite formatering
print("\n--- 12x12 Distance Matrix ---")
header = "      " + "  ".join([f"{i+1:02d}" for i in range(12)])
print(header)

for i, row in enumerate(dist_matrix):
    row_str = f"{i+1:02d} | " + "  ".join([f"{val:.2f}" for val in row])
    print(row_str)

print("\n(Låga värden betyder hög likhet, 0.00 på diagonalen är bilden jämförd med sig själv)")

# --- Interaktiv Rankning ---

try:
    # Fråga användaren efter en bild (1-12)
    choice = int(input("\nVälj en bild att utgå ifrån (skriv ett nummer mellan 1 och 12): "))
    
    if 1 <= choice <= 12:
        chosen_idx = choice - 1  # Justera för 0-indexering
        chosen_name = valid_images[chosen_idx]
        
        print(f"\nRanking av bilder baserat på likhet med: {chosen_name}")
        print("-" * 50)
        
        # Hämta avstånden för den valda bilden från vår 12x12 matris 
        distances = dist_matrix[chosen_idx]
        
        # Sortera index baserat på avstånd (lägst först)
        # np.argsort returnerar indexen i den ordning värdena i listan skulle sorteras
        sorted_indices = np.argsort(distances)
        
        rank = 1
        for idx in sorted_indices:
            # Hoppa över bilden själv (där avståndet alltid är 0)
            if idx == chosen_idx:
                continue
            
            img_name = valid_images[idx]
            dist_val = distances[idx]
            
            print(f"Rank {rank}: {img_name} | Avstånd: {dist_val:.4f}")
            rank += 1





        # --- Inuti din 'if 1 <= choice <= 12:'-sats, efter dist_matrix har beräknats ---

        # Förbered data för plottning
        # Vi tar bort den valda bilden själv från listan så vi bara ser jämförelsen med de andra
        plot_labels = []
        plot_distances = []

        for idx in sorted_indices:
            if idx == chosen_idx:
                continue # Hoppa över oss själva
            plot_labels.append(valid_images[idx])
            plot_distances.append(distances[idx])

        # Skapa stapeldiagrammet
        plt.figure(figsize=(10, 6))
        bars = plt.bar(plot_labels, plot_distances, color='skyblue', edgecolor='navy')

        # Lägg till titlar och etiketter
        plt.title(f"Likhet med {chosen_name} (Kortare stapel = Mer lik)", fontsize=14)
        plt.ylabel("Euklidiskt avstånd", fontsize=12)
        plt.xlabel("Bildnamn", fontsize=12)
        plt.xticks(rotation=45) # Luta namnen så de syns bättre

        # Lägg till värdet ovanpå varje stapel
        for bar in bars:
            yval = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2, yval + 0.01, f"{yval:.2f}", ha='center', va='bottom')

        plt.grid(axis='y', linestyle='--', alpha=0.7)
        plt.tight_layout()
        plt.show()    
    else:
        print("Fel: Vänligen välj ett nummer mellan 1 och 12.")

except ValueError:
    print("Fel: Du måste skriva en siffra.")