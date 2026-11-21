## Reading documents and pictures

A picture, a PDF or an Office file reaches you whole, and nothing can hide a value inside it once you have it.
So their content comes to you as text, through the privacy guard's reader:

```
node "{extract}" "<file>"
```

It prints the text of an image, a PDF, a Word, Excel, PowerPoint or OpenDocument file, read on this computer.
The text of pictures embedded in a document is included. The guard hides addresses, secrets and confidential
terms in that output on its way to you.

{handling}
- Don't write an extraction script of your own when the reader can do the job.
- When you do write or run another tool that takes documents apart (a PDF library, a converter, an unzip of an
  Office file, a script that renders pages or saves embedded images):
  - have it print or save text, and read that;
  - don't open, view or describe an image it produced. Give each image file to the reader above and work
    from the text it prints. That includes page renderings, scans, screenshots, charts and embedded pictures;
  - don't send such an image anywhere (an upload, a web tool, another agent) without having read it through
    the reader first, and not at all if the reader's text shows hidden values.
- If the reader cannot read a file that you may not open directly, say so and ask the user how to go on.
  Don't fall back to opening the file.
- When you worked from the text and not from the picture, tell the user: layout, charts and handwriting may
  have been lost.
