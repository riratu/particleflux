<?php

$source_folder = "sounds/main";
$destination_folder = "sounds/compressed";

// Recursively find all .wav and .mp3 files
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($source_folder),
    RecursiveIteratorIterator::LEAVES_ONLY
);

$iterator->setMaxDepth(1);

$jsFile = fopen("sounds/soundsFiles.js", "w");
fwrite($jsFile, "let soundsFiles = [\n");

foreach ($iterator as $file) {
    if ($file->isFile()) {
        $source_file = $file->getPathname();
        echo "source File: " . $source_file . "\n";
        $relative_path = substr($source_file, strlen($source_folder) + 1);
        echo $relative_path . "\n";

        $dir_name = dirname($relative_path);

        // Create the same subfolder structure in the destination folder
        $dest_dir = $destination_folder . '/' . $dir_name;
        if (!is_dir($dest_dir)) {
            mkdir($dest_dir, 0755, true);  // Changed permissions to 0755
        }

        // Define the output file path
        $destination_file = $destination_folder . '/' . $relative_path;

        // Handle .mp3 files: copy them if they don't already exist in the destination
        if (pathinfo($source_file, PATHINFO_EXTENSION) === 'mp3') {
            if (!file_exists($destination_file) || filemtime($source_file) > filemtime($destination_file)) {
                copy($source_file, $destination_file);
            }
            fwrite($jsFile, "    \"$relative_path\",\n");
        } else {
            if (pathinfo($source_file, PATHINFO_EXTENSION) === 'wav') {
                // Convert .wav to .mp3 only if it's newer or doesn't exist
                $mp3_file = preg_replace('/\.wav$/', '.mp3', $destination_file);
                if (! file_exists($mp3_file) || filemtime($source_file) > filemtime($mp3_file)) {
                    $cmd = "ffmpeg -y -i \"$source_file\" \"$mp3_file\"";
                    exec($cmd);
                }
                $relative_path_mp3 = substr($mp3_file, strlen($destination_folder) + 1);
                fwrite($jsFile, "    \"$relative_path_mp3\",\n");
            }
        }
    }
}
// Remove last comma and close the array
fseek($jsFile, -2, SEEK_END);
fwrite($jsFile, "\n];\nexport default soundsFiles;\n");
fclose($jsFile);
?>
