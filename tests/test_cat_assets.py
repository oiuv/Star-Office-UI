"""Validate the texture contract used by Phaser and the mini desktop pet."""
from pathlib import Path
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = [
    ("star-idle-v5.png", 256, (8,6), 48),
    ("star-working-spritesheet-grid.webp", 300, (8,5), 38),
    ("sync-animation-v3-grid.webp", 256, (7,7), 49),
    ("error-bug-spritesheet-grid.webp", 220, (8,9), 72),
]


class CatAssetsTests(unittest.TestCase):
    def test_grids_decode_and_every_played_frame_contains_pixels(self):
        for name, cell, grid, count in CONTRACT:
            with self.subTest(name=name), Image.open(ROOT/"frontend"/name) as image:
                self.assertEqual(image.mode,"RGBA")
                self.assertEqual(image.size,(cell*grid[0],cell*grid[1]))
                image.load()
                for index in range(count):
                    x,y=(index%grid[0])*cell,(index//grid[0])*cell
                    frame=image.crop((x,y,x+cell,y+cell))
                    self.assertIsNotNone(frame.getchannel("A").getbbox(),(name,index))
                # Unused working cells must not accidentally become extra poses.
                for index in range(count,grid[0]*grid[1]):
                    x,y=(index%grid[0])*cell,(index//grid[0])*cell
                    self.assertIsNone(image.crop((x,y,x+cell,y+cell)).getchannel("A").getbbox())

    def test_each_state_has_multiple_distinct_poses(self):
        for name,cell,grid,count in CONTRACT:
            with self.subTest(name=name), Image.open(ROOT/"frontend"/name) as image:
                first=1 if name.startswith("sync-") else 0
                last=count-1 if first else count
                poses=set()
                for index in range(first,last):
                    x,y=(index%grid[0])*cell,(index//grid[0])*cell
                    poses.add(image.crop((x,y,x+cell,y+cell)).tobytes())
                self.assertGreaterEqual(len(poses),3)

    def test_sync_keeps_the_original_empty_bed_outside_active_frames(self):
        empty=Image.open(ROOT/"art"/"star-cat"/"empty-bed.png").convert("RGBA")
        with Image.open(ROOT/"frontend"/"sync-animation-v3-grid.webp") as image:
            self.assertEqual(image.crop((0,0,256,256)).tobytes(),empty.tobytes())
            self.assertEqual(image.crop((1536,1536,1792,1792)).tobytes(),empty.tobytes())

    def test_normal_cat_frames_have_transparent_padding(self):
        for name,cell,grid,count in CONTRACT:
            with self.subTest(name=name), Image.open(ROOT/"frontend"/name) as image:
                start,end=(1,count-1) if name.startswith("sync-") else (0,count)
                for index in range(start,end):
                    x,y=(index%grid[0])*cell,(index//grid[0])*cell
                    alpha=image.crop((x,y,x+cell,y+cell)).getchannel("A")
                    box=alpha.point(lambda a: 255 if a>=16 else 0).getbbox()
                    self.assertGreaterEqual(min(box[0],box[1]),8)
                    self.assertLessEqual(max(box[2],box[3]),cell-8)


if __name__ == "__main__":
    unittest.main()
