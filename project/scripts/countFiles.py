import os

# folder path
dir_path = r'C:\Programmering\TNM098\project\data\ALL BIRDS'
count = 0
# Iterate directory
for path in os.listdir(dir_path):
    # check if current path is a file
    if os.path.isfile(os.path.join(dir_path, path)):
        count += 1
print('File count:', count)