# TNM098 Lab 1 - Spatiotemporal Eye-Tracking Analysis

This guide provides a step-by-step architectural plan to build a complete visual analysis dashboard using JavaScript and D3.js. [cite_start]By following these steps, you will construct a tool capable of answering all the questions of interest outlined in the assignment[cite: 22, 47].

## 1. Project Setup & Data Parsing
[cite_start]The raw data has been pre-processed to contain only fixations[cite: 13, 37]. [cite_start]There are 6 fields per sample[cite: 14, 38].

**Implementation Steps:**
* Set up a standard HTML/JS project and import **D3.js** (v7 recommended).
* Use `d3.csv()` or `d3.tsv()` to load your dataset.
* Parse the 6 fields properly:
    * [cite_start]Timestamp (convert to a usable relative time or keep as milliseconds)[cite: 15, 39].
    * [cite_start]Fixation index (integer)[cite: 16, 40].
    * [cite_start]Event duration in milliseconds (integer)[cite: 17, 41].
    * [cite_start]Gaze point index (ignore or store as integer)[cite: 18, 42].
    * [cite_start]X coordinate (float/integer)[cite: 19, 43].
    * [cite_start]Y coordinate (float/integer)[cite: 20, 44].

## 2. Spatial Analysis: Plotting Fixations
**Goal:** Visualize where the user is looking.
**Answers:** Identifies raw visual patterns before clustering.

**Implementation Steps (The "Scatter & Heatmap" approach):**
* **Scatter Plot:** Create an SVG canvas matching the aspect ratio of the screen where the eye-tracking occurred. Map the X and Y coordinates to `cx` and `cy` of SVG `<circle>` elements.
* [cite_start]**Transparency:** Set a low `opacity` (e.g., `0.1`) on the circles so dense areas become darker, immediately revealing hotspots[cite: 45].
* **Duration Mapping:** Map the "event duration" to the radius (`r`) of the circles so longer fixations appear larger.
* [cite_start]**Density/Heatmap:** Use `d3-contour` to calculate Kernel Density Estimation (KDE) and draw contour polygons to create a heatmap over the scatter plot[cite: 45].

## 3. Extracting Areas of Interest (AOIs)
[cite_start]**Goal:** Group fixations into semantic regions[cite: 21].
[cite_start]**Answers:** "How many regions/areas of interest can be identified?"[cite: 23, 48].

**Implementation Steps:**
* [cite_start]**Clustering (Density-based):** Since D3 doesn't have a built-in DBSCAN algorithm, you have two choices[cite: 46]:
    1.  [cite_start]*Analytical approach:* Run a quick clustering script (like DBSCAN or K-Means) in Python beforehand and add a "Cluster_ID" column to your CSV[cite: 29].
    2.  [cite_start]*Visual/Manual tessellation:* Draw rectangular bounding boxes (SVG `<rect>` elements) interactively over the densest parts of your scatter plot/heatmap and use D3 to filter/classify data points based on which bounding box they fall into[cite: 46].
* Assign a distinct categorical color (using `d3.scaleOrdinal()`) to each identified region.

## 4. Temporal Analysis: Region Usage Over Time
**Goal:** Understand *when* users look at specific regions.
[cite_start]**Answers:** "How many are heavily used and when?" [cite: 24, 49] [cite_start]and "Which regions are only used for part of the analysis procedure?"[cite: 25, 50].

**Implementation Steps:**
* **Frequency Timeline:** Create a stacked bar chart or a multi-line chart below your main scatter plot.
    * **X-axis:** Time (binned into 10-second or 30-second intervals based on the timestamp).
    * [cite_start]**Y-axis:** Plot frequency of region visits over time[cite: 55].
    * **Color:** Match the colors assigned to your AOIs in Step 3.
* **Animation:** Add a slider (HTML `<input type="range">`) tied to the timestamp. As the slider moves, update the scatter plot to only show fixations that occurred within a sliding time window. [cite_start]This fulfills the "animate fixation plot" suggestion[cite: 55].

## 5. Transition & Flow Analysis
**Goal:** Analyze how the user's gaze moves between regions.
[cite_start]**Answers:** "What are the frequent transitions between the areas of interest?"[cite: 26, 51].

**Implementation Steps:**
* **Calculate the Transition Matrix:** Write a JavaScript function to iterate through the data chronologically. [cite_start]Every time a fixation's AOI differs from the previous fixation's AOI, increment a counter for that specific `Source -> Target` pair to extract flows between regions[cite: 56].
* **Visualizing Flows:**
    * [cite_start]*Approach A (Chord Diagram):* Use `d3-chord` to map the transition matrix[cite: 56]. [cite_start]Map the flows with magnitude[cite: 56].
    * *Approach B (Node-Link Map):* Overlay directional arrows/lines on top of your scatter plot connecting the center points of your AOIs. Map the stroke-width of the lines to the transition frequency.

## 6. Advanced Spatiotemporal Patterns
**Goal:** Combine time and transitions.
[cite_start]**Answers:** "How do those transition patterns change over time?"[cite: 27, 52].

**Implementation Steps:**
* **Animated Flows:** Tie your node-link map (from Step 5) to the time slider (from Step 4). [cite_start]Instead of calculating the transition matrix for the whole 5 minutes, calculate it dynamically for the active time window to plot transitions over time[cite: 57].
* **Space-Time Cube (Ambitious):** If you are comfortable, use a lightweight 3D library (like Three.js or Plotly.js) alongside D3. [cite_start]Plot X and Y on the ground plane, and map the Timestamp to the Z-axis (height) to create a space-time cube[cite: 58]. Draw lines connecting chronological fixations.

---

### TA Presentation Checklist
1.  [cite_start]**Analysis Approach:** Describe your analysis approach and your proposed solution to the teaching assistant[cite: 31].
2.  **Demonstrate Parsing:** Start by showing the static scatter plot with transparency to prove you've parsed the X/Y coordinates correctly.
3.  **Define Regions:** Demonstrate how you defined your regions of interest.
4.  [cite_start]**Temporal Spikes:** Use the timeline chart to highlight regions that were "only used for part of the analysis"[cite: 25].
5.  [cite_start]**Flows:** Show your transition matrix/flow map to definitively answer what the frequent transitions are[cite: 26].
6.  [cite_start]**Additional Insights:** Discuss potential additional insights your solution makes possible[cite: 32].