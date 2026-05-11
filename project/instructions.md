# TNM098: Advanced Visual Data Analysis - Project Overview

[cite_start]**Course Context:** This project is worth 5 credits (hp) and is designed to take about 130 hours of work over 4 weeks[cite: 4]. [cite_start]The final grade is weighted heavily on the implementation: Programming part (50%), Oral presentation (25%), and Report writing (25%)[cite: 7, 8, 9].
**Dataset:** VAST Challenge 2018, Mini-Challenge 1 (The Bird Audio Challenge).
[cite_start]**Core Goal:** A data-driven visual analysis process needs to be defined and implemented to solve the problem[cite: 13].

---

## 1. The Mystery (Problem Statement)
The Boonsong Lekagul Nature Preserve is home to the protected, endangered **Rose-Crested Blue Pipit**. Recently, a local manufacturing company, Kasios Furniture, has been suspected of dumping toxic chemicals into the preserve, causing a severe decline in the Pipit population. 

To avoid legal trouble and being shut down, Kasios has released 15 audio recordings of what they *claim* are healthy Pipits singing throughout the preserve. We are provided with a historical database of over 2,000 verified bird calls (and their geospatial/temporal metadata) alongside these 15 suspicious recordings. Our job is to use visual analytics to act as environmental detectives and uncover the truth.

---

## 2. Questions to Answer
Through our visual analytics tool, we must answer the following questions:
1. **Are the Kasios recordings authentic?** Can we visually prove if the 15 recordings provided by Kasios Furniture are genuine Rose-Crested Blue Pipits, or if they have been falsified, manipulated, or misidentified?
2. **What is the spatial distribution over time?** How has the bird population moved and changed density across the preserve over the years?
3. **Where is the toxic dumping happening?** By visualizing the spatiotemporal data, can we correlate sudden drops or anomalies in the bird population to pinpoint the exact geographic location of the alleged toxic dumping?

---

## 3. Technology Stack & Deployment
To maximize performance and ensure a seamless demonstration, we will use a **hybrid data pipeline** and a modern JavaScript ecosystem hosted on Vercel.

* **Offline Pre-processing:** Python (`pandas`, `librosa`)
* **Frontend Framework:** Next.js (React)
* **Visualization Libraries:** D3.js (for complex, custom SVG/Canvas charts and interactive mapping elements)
* **Audio Processing (In-Browser):** Web Audio API (for real-time Fast Fourier Transforms (FFT) and live spectrogram generation)
* **Hosting:** Vercel

---

## 4. Implementation Strategy (How to Solve It)

### Phase 1: Data Pre-processing (The Offline Pipeline)
Do **not** attempt to load and process 2,000+ audio files in the browser. 
1. Write a local Python script using `librosa` to scan the historical database.
2. Extract the relevant metadata (Timestamp, X/Y Coordinates, Bird Species, Audio Length) and compute static baseline audio features.
3. Export this clean, structured data into a lightweight `data.json` file. 

### Phase 2: The Geospatial Dashboard (Next.js + D3.js)
1. Load the `data.json` file into the Next.js application.
2. Build an interactive map of the preserve using D3.js to plot the X/Y coordinates of the bird calls. 
3. Implement a **time-lapse slider** to filter the data by year/month. This will create a spatiotemporal heatmap, allowing the user to visually spot when and where the Pipit population suddenly disappears (solving the dumping location question).

### Phase 3: The "Lie Detector" Dashboard (Web Audio API)
1. Build an interactive component specifically for the 15 Kasios audio files.
2. Use the **Web Audio API's `AnalyserNode`** to perform live FFTs on the audio files directly in the browser when clicked.
3. Use D3.js to draw the live frequency data onto a Canvas element, generating a visual **Spectrogram**.
4. Allow the user to overlay a Kasios spectrogram onto a verified, baseline Pipit spectrogram. Mismatched peaks and valleys will visually prove the audio is fake.

### Phase 4: The Oral Demonstration
[cite_start]For the final oral presentation, which is worth 25% of the grade[cite: 8], we will incorporate an interactive "Spot the Fake" game. We will play an audio clip for the audience and display two generated D3.js spectrograms (one real, one fake), challenging them to visually identify the authentic bird call based on the data.

---

## 5. Important Deadlines
* [cite_start]**Planning Report:** Due Friday 24/4 via Lisam[cite: 39].
* [cite_start]**Slide Submission:** Submit presentation slides on Lisam by Sunday 24/5[cite: 43].
* [cite_start]**Oral Demonstration:** Monday 25/5, 13-17[cite: 42].
* [cite_start]**Final Report & Code Submission:** Due Friday 5/6 via Lisam[cite: 60]. [cite_start]The final report must be 3-4 pages long, plus an additional page detailing individual contributions, and must use the provided LaTeX template[cite: 57, 58].