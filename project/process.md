# TNM098 - Project Process & Decisions

This document tracks our implementation steps, decisions, and reasoning for the visual analytics project. It will serve as a reference for the final report and oral presentation.

## Phase 1: Data Pre-processing (Audio Analysis)

**The Problem:** We needed a way to compare the 15 suspicious Kasios audio files against over 2,000 verified Rose-Crested Blue Pipit recordings. If we just averaged all verified files into one "general" sound, we would blur the distinct features of the bird's voice and lose crucial data.

**The Solution:** Instead of an average, we decided to programmatically find the exact "Best Match" and "Worst Match" verified recording for *each* individual Kasios file. We also split the verified recordings into two distinct groups based on the metadata: **Calls** (short sounds) and **Songs** (complex melodies). By visualizing a Kasios file against its absolute *best possible* verified match, we can clearly prove if it's still fake. Showing the *worst match* helps demonstrate natural variance.

**Implementation Details:**
We built a local Python pipeline (`scripts/analyze_audio.py`) to process the data offline rather than overloading the browser:
1. **MFCC Extraction (`librosa`):** We converted the raw audio waveforms into Mel-frequency cepstral coefficients (MFCCs). This acts as a mathematical "fingerprint" of the audio's structure, focusing on vocal shape rather than raw volume.
2. **Dynamic Time Warping (`fastdtw`):** Since birds sing at different speeds, a direct frame-by-frame comparison wouldn't work. We used DTW to temporally stretch and align the MFCC fingerprints before calculating their similarity distance.
3. **Data Export:** The script compares every Kasios file against every verified Call and Song, scoring them via DTW. It exports a `comparisons.json` file containing the IDs of the best/worst matches, which the Next.js frontend will consume to load the correct MP3s for the live spectrogram visualization.

**Thoughts:**
- This method works best if files dont contain a lot of noise or irrelevant sound, like for exmaple wind or water flowing etc.
- Good to seperate calls and song, as larger differences in time makes it possible for similiar files to be classified wrongly 

## Phase 2: Geospatial Dashboard

**The Problem:** We need to visualize the spatial distribution of the Pipit population over time to identify when and where they suddenly disappear, pinpointing the toxic dumping site.

**The Solution:** We will build an interactive map using D3.js overlaid on the 'Lekagul Roadways 2018' map. The map will feature a spatiotemporal slider allowing the user to filter recordings by Month and Year. We also added the ability to toggle between scatterplot dots (for precise locations) and a heatmap (for density tracking), along with filters for 'Calls' vs. 'Songs'.

**Data Pre-processing:** To make the browser visualization fast, we wrote a Python script (scripts/preprocess_map_data.py) to parse AllBirdsv4.csv, filter for only the Rose-crested Blue Pipit, format the dates into sortable 'Year-Month' strings, and output a lightweight public/map_data.json.
**Phase 2 Updates:** Refined the dashboard to support comparative analysis across all species. Upgraded the timeline to use dual Start/End sliders for cumulative time-span filtering. Transformed the UI layout with a sidebar for complex filtering: Multi-select checkboxes for species (each mapped to a distinct color), and categorized vocalizations (Calls = Circle, Songs = Triangle, Both = Square) utilizing D3 symbols. Added explicit UI hints explaining that Heatmap density reflects total population across all selected species rather than individual categorical colors.

## Phase 3: The Lie Detector Dashboard

**The Problem:** We need a way to prove that the Kasios audio files are faked. Comparing raw waveforms visually is difficult because variations in timing and volume can make identical birds look different. We needed a frequency-based visualization that users could easily interpret.

**The Solution:** We built a custom React dashboard component (LieDetector.tsx) that reads the comparisons.json file generated in Phase 1. It pairs the suspicious Kasios recording against its mathematically computed 'Best Match' baseline recording. Using the Web Audio API, we draw live Fast Fourier Transform (FFT) data onto an HTML5 Canvas (AudioVisualizer.tsx). By toggling to the 'Spectrogram' view (which acts as a frequency bar spectrum), users can play the audio and clearly see if the Kasios recording contains frequency peaks that physically cannot exist in the verified Pipit recordings, thus proving manipulation.

**Implementation Detail:** To avoid duplicating the 2000+ audio files into the public directory, we created a Next.js API route (pp/api/audio/route.ts) that safely proxies the local file streams directly to the <audio> elements in the browser.

**Phase 3 Visual Overhaul:** Based on feedback, the live-scrolling canvas was replaced with a static overview renderer using \wavesurfer.js\. This allows the user to see the entire waveform and spectrogram at a glance, making it much easier to count distinct audio events and compare overall structural cadence. A playback cursor traces over the static visual as the audio plays. We also implemented a 'hot' color map (black to red to yellow) for the spectrogram to explicitly highlight high-intensity frequency areas.
